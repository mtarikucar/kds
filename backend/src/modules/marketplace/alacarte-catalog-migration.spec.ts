import { readFileSync } from "fs";
import { join } from "path";
import {
  ALACARTE_CATALOG,
  ALACARTE_CATALOG_BY_CODE,
  RETIRED_ADDON_CODES,
} from "./alacarte-catalog.const";

/**
 * Drift tripwire between the catalog constant and the committed data
 * migration.
 *
 * The migration SQL was GENERATED from ALACARTE_CATALOG, but generated files
 * rot: someone edits a price in the constant, the seed picks it up, and
 * production — which is migrated, not seeded — keeps charging the old amount.
 * That divergence is invisible until a customer is billed the wrong figure.
 *
 * This spec re-parses the committed SQL and asserts it still says exactly what
 * the constant says. If you change a price, regenerate the migration or add a
 * follow-up one; do not "fix" this test.
 */

const MIGRATION_SQL = join(
  __dirname,
  "../../../prisma/migrations/20260811100000_alacarte_catalog/migration.sql",
);
const DOWN_SQL = join(
  __dirname,
  "../../../prisma/migrations/20260811100000_alacarte_catalog/down.sql",
);

interface ParsedRow {
  code: string;
  kind: string;
  billing: string;
  priceCents: number;
  status: string;
  requiresLicense: boolean;
}

/**
 * Drop `--` comment lines. Assertions about what the migration DOES must look
 * at executable SQL only — the header prose legitimately names `TenantAddOn`
 * and `plan:PRO` while explaining why neither appears in the statements.
 */
function executableSql(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

function parseUpserts(sql: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  // The generator emits a fixed shape; anchor on it rather than trying to be
  // a general SQL parser.
  const re =
    /gen_random_uuid\(\)::text, '([a-z0-9_]+)',[\s\S]*?\n\s+'(\w+)', '(\w+)', (\d+), 'TRY',\n[\s\S]*?::jsonb, (?:ARRAY\[[^\]]*\]::TEXT\[\]), '(\w+)', (true|false),/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    rows.push({
      code: m[1],
      kind: m[2],
      billing: m[3],
      priceCents: Number(m[4]),
      status: m[5],
      requiresLicense: m[6] === "true",
    });
  }
  return rows;
}

describe("à-la-carte catalog migration", () => {
  const sql = readFileSync(MIGRATION_SQL, "utf8");
  const down = readFileSync(DOWN_SQL, "utf8");
  const sqlOnly = executableSql(sql);
  const downOnly = executableSql(down);
  const parsed = parseUpserts(sql);

  it("upserts exactly the products in the catalog constant", () => {
    expect(parsed.map((r) => r.code).sort()).toEqual(
      ALACARTE_CATALOG.map((p) => p.code).sort(),
    );
  });

  it("carries the same kind, billing and PRICE as the constant", () => {
    for (const row of parsed) {
      const product = ALACARTE_CATALOG_BY_CODE.get(row.code)!;
      expect({
        code: row.code,
        kind: row.kind,
        billing: row.billing,
        priceCents: row.priceCents,
        requiresLicense: row.requiresLicense,
      }).toEqual({
        code: product.code,
        kind: product.kind,
        billing: product.billing,
        priceCents: product.priceCents,
        requiresLicense: product.requiresLicense,
      });
    }
  });

  it("lands every annual and credit product as draft, then publishes them in P2", () => {
    // P1 could not publish an annual row: QuoteService still mapped a
    // non-recurring cadence to oneTime and purchase() still gave it a 30-day
    // period, so a published ₺2.990/yr licence would have been sold as a flat
    // 30-day charge. The follow-up migration takes them live alongside the
    // proration engine — and must cover EVERY product it drafted, or a
    // product silently stays unbuyable forever.
    const publishSql = readFileSync(
      join(
        __dirname,
        "../../../prisma/migrations/20260811110000_alacarte_publish_catalog/migration.sql",
      ),
      "utf8",
    );
    for (const row of parsed) {
      if (row.kind === "service") {
        expect(row.status).toBe("published");
      } else {
        expect(row.status).toBe("draft");
        expect(publishSql).toContain(`'${row.code}'`);
      }
    }
    expect(publishSql).toMatch(/SET "status" = 'published'/);
  });

  it("archives — never deletes — the retired device-capacity products", () => {
    // code is not reusable and TenantAddOn.addOnId is onDelete: Restrict.
    for (const code of RETIRED_ADDON_CODES) {
      expect(sql).toContain(`'${code}'`);
    }
    expect(sqlOnly).toMatch(/SET "status" = 'archived'/);
    expect(sqlOnly).not.toMatch(/DELETE FROM "marketplace_addons"/);
  });

  it("clears the retired plan: dep from fiscal_hugin", () => {
    const hugin = parsed.find((r) => r.code === "fiscal_hugin");
    expect(hugin).toBeDefined();
    // No executable statement may carry a plan: dep. Plans are retired, so
    // such a dep can never resolve and would 400 every Hugin purchase.
    expect(sqlOnly).not.toContain("plan:");
  });

  it("uses the snake_case mapped table name everywhere", () => {
    // A hand-written migration that says "MarketplaceAddOn" takes 42P01 in
    // production and passes every test that runs against a db-push database.
    expect(sqlOnly).not.toMatch(/"MarketplaceAddOn"|"TenantAddOn"|"Tenant"/);
    expect(downOnly).not.toMatch(/"MarketplaceAddOn"|"TenantAddOn"|"Tenant"/);
    expect(sqlOnly).toContain('"marketplace_addons"');
    expect(downOnly).toContain('"tenant_addons"');
  });

  it("has a down that restores every pre-3.3 code and guards paid deletes", () => {
    const preExisting = [
      "kds_extra_screen",
      "kds_extra_station",
      "extra_tablet",
      "extra_branch",
      "fiscal_efatura",
      "fiscal_hugin",
      "delivery_yemeksepeti",
      "delivery_getir",
      "delivery_trendyol_yemek",
      "caller_id_integration",
      "advanced_reports",
      "api_access",
      "priority_support",
      "onsite_install_full",
    ];
    for (const code of preExisting) {
      expect(downOnly).toContain(`'${code}'`);
    }
    // The rollback restores the original (buggy) dep — that WAS the state.
    expect(downOnly).toContain("ARRAY['plan:PRO']::TEXT[]");
    // And it must never strand a purchase.
    expect(downOnly).toMatch(
      /DELETE FROM "marketplace_addons"[\s\S]*NOT EXISTS[\s\S]*"tenant_addons"/,
    );
  });

  it("deletes in the down exactly the codes the up introduced", () => {
    const preExisting = new Set([
      "kds_extra_screen",
      "kds_extra_station",
      "extra_tablet",
      "extra_branch",
      "fiscal_efatura",
      "fiscal_hugin",
      "delivery_yemeksepeti",
      "delivery_getir",
      "delivery_trendyol_yemek",
      "caller_id_integration",
      "advanced_reports",
      "api_access",
      "priority_support",
      "onsite_install_full",
    ]);
    const introduced = ALACARTE_CATALOG.map((p) => p.code)
      .filter((c) => !preExisting.has(c))
      .sort();
    const deleteBlock = downOnly.slice(downOnly.indexOf("DELETE FROM"));
    for (const code of introduced) {
      expect(deleteBlock).toContain(`'${code}'`);
    }
    // ...and nothing that pre-existed.
    for (const code of preExisting) {
      expect(deleteBlock).not.toContain(`'${code}'`);
    }
  });
});
