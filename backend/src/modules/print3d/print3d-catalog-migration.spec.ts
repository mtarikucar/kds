import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  PRINT3D_BASE_PRICE_CENTS,
  PRINT3D_BASE_SKU,
  PRINT3D_ITEM_PRICE_CENTS,
  PRINT3D_ITEM_SKU,
} from "./print3d.const";
import {
  SEED_DEFAULT_COMPLIANCE,
  SERVICES,
} from "../../../prisma/seeds/seed-marketplace";

/**
 * Donanım rayının katalog sürüklenme tripwire'ı.
 *
 * Add-on rayında bunun karşılığı (alacarte-catalog-migration.spec.ts) yıllardır
 * var; donanım rayında HİÇ YOKTU. Prodüksiyon migre edilir, tohumlanmaz — yani
 * tohumdaki bir fiyat düzeltmesi prodüksiyonu ESKİ tutarla faturalandırmaya
 * devam eder ve bu, müşteri yanlış tutarı ödeyene kadar görünmez.
 *
 * Uygulanmış migration'ı DÜZENLEME. Fiyat değişirse yeni bir takip
 * migration'ı yaz; bu dosyaya bir FOLLOW_UP_SQL listesi eklemek gerekirse
 * dosyaları İSİMLE ara (`FOLLOW_UP_SQL.find((p) => p.includes("…"))`), ASLA
 * indeksle — araya bir giriş sokulunca iddialar sessizce başka dosyayı
 * göstermesin.
 */
const MIGRATION_DIR = join(
  __dirname,
  "../../../prisma/migrations/20260820170000_print3d_service",
);
const MIGRATION_SQL = join(MIGRATION_DIR, "migration.sql");
const DOWN_SQL = join(MIGRATION_DIR, "down.sql");

/** `--` yorum satırlarını at: iddialar YALNIZCA çalışan SQL'e bakmalı. */
function executableSql(sql: string): string {
  return sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

function priceForSku(sql: string, sku: string): number {
  // VALUES bloğundaki satır: gen_random_uuid()::text, 'sku', 'service', …,
  // <priceCents>, 'TRY',
  const row = sql.slice(sql.indexOf(`'${sku}'`));
  const m = row.match(/,\s*(\d+),\s*'TRY'/);
  if (!m) throw new Error(`price not found for ${sku}`);
  return Number(m[1]);
}

describe("print3d catalog migration (drift tripwire)", () => {
  const up = readFileSync(MIGRATION_SQL, "utf8");
  const down = readFileSync(DOWN_SQL, "utf8");
  const upExec = executableSql(up);
  const downExec = executableSql(down);

  it("the migration directory ships both migration.sql and down.sql", () => {
    expect(existsSync(MIGRATION_SQL)).toBe(true);
    expect(existsSync(DOWN_SQL)).toBe(true);
  });

  it("carries the @doctor:idempotent header", () => {
    expect(up.split("\n")[0]).toContain("@doctor:idempotent");
  });

  it("the committed migration prices print3d_base at PRINT3D_BASE_PRICE_CENTS", () => {
    expect(priceForSku(upExec, PRINT3D_BASE_SKU)).toBe(PRINT3D_BASE_PRICE_CENTS);
  });

  it("the committed migration prices print3d_item at PRINT3D_ITEM_PRICE_CENTS", () => {
    expect(priceForSku(upExec, PRINT3D_ITEM_SKU)).toBe(PRINT3D_ITEM_PRICE_CENTS);
  });

  it("writes exactly SEED_DEFAULT_COMPLIANCE as complianceDocs on both rows", () => {
    const blobs = upExec.match(/'\{"invoiceIssued":true\}'::jsonb/g) ?? [];
    expect(blobs).toHaveLength(2);
    expect(SEED_DEFAULT_COMPLIANCE).toEqual({ invoiceIssued: true });
    // distributorName gibi bir ek anahtar tohumla kalıcı ayrışma demektir.
    expect(upExec).not.toContain("distributorName");
  });

  it("the seed SERVICES array agrees with the migration on both SKUs", () => {
    for (const [sku, cents] of [
      [PRINT3D_BASE_SKU, PRINT3D_BASE_PRICE_CENTS],
      [PRINT3D_ITEM_SKU, PRINT3D_ITEM_PRICE_CENTS],
    ] as const) {
      const seeded = SERVICES.find((s) => s.sku === sku) as any;
      expect(seeded).toBeDefined();
      expect(seeded.priceCents).toBe(cents);
      expect(seeded.category).toBe("service");
      expect(seeded.serviceMeta.serviceType).toBe("print3d");
      expect(seeded.serviceMeta.partner).toBe("figurunica");
      expect(priceForSku(upExec, sku)).toBe(seeded.priceCents);
      // Tohum status/saleMode/complianceDocs YAZMAZ — ortak upsert atar.
      expect(seeded.status).toBeUndefined();
      expect(seeded.saleMode).toBeUndefined();
      expect(seeded.complianceDocs).toBeUndefined();
    }
  });

  it("uses the snake_case mapped table names everywhere", () => {
    expect(upExec).not.toMatch(/"HardwareProduct"|"Product"|"HardwareOrder"/);
    expect(downExec).not.toMatch(/"HardwareProduct"|"Product"|"HardwareOrder"/);
    expect(upExec).toContain('"hardware_products"');
    expect(upExec).toContain('"print3d_jobs"');
    expect(upExec).toContain('"products"');
  });

  it("the ON CONFLICT DO UPDATE does not overwrite status", () => {
    const block = upExec.match(/ON CONFLICT[\s\S]*?DO UPDATE[\s\S]*?;/)?.[0];
    expect(block).toBeDefined();
    expect(block).not.toContain('"status"');
  });

  it("never DELETEs a catalog row without a NOT EXISTS guard over paid rows", () => {
    const del = downExec.match(
      /DELETE FROM "hardware_products"[\s\S]*?;/,
    )?.[0];
    expect(del).toBeDefined();
    expect(del).toContain("NOT EXISTS");
    expect(del).toContain('"hardware_order_items"');
    expect(del).toContain('"print3d_jobs"');
  });

  it("refuses to drop print3d_jobs while any job row exists", () => {
    const raiseAt = downExec.search(/RAISE EXCEPTION/);
    const dropAt = downExec.search(/DROP TABLE/);
    expect(raiseAt).toBeGreaterThan(-1);
    expect(dropAt).toBeGreaterThan(-1);
    // Guard, DROP'lardan ÖNCE gelmeli — aksi halde koruduğu veriyi kendisi yok eder.
    expect(raiseAt).toBeLessThan(dropAt);
    expect(downExec.slice(raiseAt, raiseAt + 200)).toContain("print3d_jobs");
  });

  it("guards every print3d_jobs reference in the down with to_regclass", () => {
    // İkinci koşuda tablo yok; korumasız her okuma 42P01 undefined_table verir.
    const guards = downExec.match(/to_regclass\('public\.print3d_jobs'\)/g) ?? [];
    const reads = downExec.match(/FROM "print3d_jobs"/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
    expect(reads.length).toBeGreaterThan(0);
  });

  it("never issues an unscoped DELETE on hardware_inventory", () => {
    const del = downExec.match(
      /DELETE FROM "hardware_inventory"[\s\S]*?;/,
    )?.[0];
    expect(del).toBeDefined();
    expect(del).toContain("'print3d_base'");
    expect(del).toContain("'print3d_item'");
  });

  it("sorts after every sibling v3.7.0 migration in the chain", () => {
    const name = "20260820170000_print3d_service";
    for (const sibling of [
      "20260820120000_reprice_licence_and_stock",
      "20260820140000_delivery_platforms_bundle",
      "20260820150000_card_shift_schema",
      "20260820160000_card_shift_catalog",
    ]) {
      expect(name > sibling).toBe(true);
    }
  });
});
