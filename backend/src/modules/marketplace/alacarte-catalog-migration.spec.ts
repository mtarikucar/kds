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

/**
 * Follow-up migrations that change what the base catalog migration wrote.
 *
 * The tripwire compares the constant against the COMPOSED state — base
 * migration plus every follow-up listed here — rather than against the base
 * alone. Comparing against the base alone would make any legitimate reprice
 * impossible without rewriting an already-applied migration, which is the one
 * thing a migration may never do. Add a file here whenever a new migration
 * changes a catalog price or retires a product.
 */
const FOLLOW_UP_SQL = [
  // ALWAYS ordered by migration folder stamp. Insert, never append: the fold
  // lets a later row overwrite an earlier one, so an out-of-order entry makes
  // the composed state disagree with what `prisma migrate deploy` produces.
  "20260820120000_reprice_licence_and_stock/migration.sql",
  "20260820140000_delivery_platforms_bundle/migration.sql",
].map((rel) => join(__dirname, "../../../prisma/migrations", rel));

// Addressed BY NAME, never by index. `FOLLOW_UP_SQL[1]` points at a different
// migration the moment someone inserts one above it, and the assertions below
// would then silently verify the wrong file.
const BUNDLE_UP = FOLLOW_UP_SQL.find((f) =>
  f.includes("delivery_platforms_bundle"),
)!;
const BUNDLE_DOWN = BUNDLE_UP.replace("migration.sql", "down.sql");

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

/**
 * Split into per-statement chunks on the UPDATE keyword rather than on `;`.
 * Semicolons appear INSIDE the copy this migration writes (the licence
 * description reads "…yıl dönümü olur; sonradan aldığınız her modül…"), so a
 * naive `split(";")` tears one statement into pieces and silently reads no
 * price at all.
 */
function updateStatements(sql: string): string[] {
  return executableSql(sql)
    .split(/(?=UPDATE\s+"marketplace_addons")/)
    .filter((s) => /UPDATE\s+"marketplace_addons"/.test(s));
}

/** code -> new priceCents, from a follow-up migration's `UPDATE ... SET`. */
function parseRepricing(sql: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const stmt of updateStatements(sql)) {
    // First price after SET is the new one; the WHERE guard deliberately
    // carries the OLD value and must not be mistaken for it.
    const price = /SET[\s\S]*?"priceCents"\s*=\s*(\d+)/.exec(stmt);
    const code = /WHERE[\s\S]*?"code"\s*=\s*'([a-z0-9_]+)'/.exec(stmt);
    if (price && code) out.set(code[1], Number(price[1]));
  }
  return out;
}

/** Codes a follow-up migration archives — retired, but never deleted. */
function parseArchived(sql: string): string[] {
  const codes: string[] = [];
  for (const stmt of updateStatements(sql)) {
    if (!/SET\s+"status"\s*=\s*'archived'/.test(stmt)) continue;
    const list = /"code"\s+IN\s*\(([^)]*)\)/.exec(stmt);
    if (list) codes.push(...[...list[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]));
  }
  return codes;
}

describe("à-la-carte catalog migration", () => {
  const sql = readFileSync(MIGRATION_SQL, "utf8");
  const down = readFileSync(DOWN_SQL, "utf8");
  const sqlOnly = executableSql(sql);
  const downOnly = executableSql(down);
  const parsed = parseUpserts(sql);

  const followUps = FOLLOW_UP_SQL.map((p) => readFileSync(p, "utf8"));
  const reprices = new Map(
    followUps.flatMap((f) => [...parseRepricing(f).entries()]),
  );
  const archivedLater = new Set(followUps.flatMap(parseArchived));

  // Codes a follow-up migration INSERTS (not just reprices/archives). Before
  // v3.6.8 every catalog row was born in the base migration, so the fold only
  // needed reprice + archive; `delivery_platforms` is the first row introduced
  // by a follow-up.
  const insertedLater = followUps.flatMap(parseUpserts);

  /** What a fully migrated database actually holds, as sellable rows. */
  const effective = [...parsed, ...insertedLater]
    .filter((r) => !archivedLater.has(r.code))
    .map((r) => ({ ...r, priceCents: reprices.get(r.code) ?? r.priceCents }));

  it("retires products only through RETIRED_ADDON_CODES", () => {
    // A follow-up that archives a row without listing it in the constant would
    // leave the seed re-publishing it on every fresh database.
    for (const code of archivedLater) {
      expect([...RETIRED_ADDON_CODES]).toContain(code);
    }
  });

  it("upserts exactly the products in the catalog constant", () => {
    expect(effective.map((r) => r.code).sort()).toEqual(
      ALACARTE_CATALOG.map((p) => p.code).sort(),
    );
  });

  it("carries the same kind, billing and PRICE as the constant", () => {
    for (const row of effective) {
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
    // The codes the BASE migration actually created. Deriving them from the
    // catalog constant is wrong: every code a FOLLOW-UP migration inserts
    // (delivery_platforms today, the card-shift row next) would join this list
    // and then be looked for in P1's down — which never created it, so it can
    // never delete it. `parsed` is the base file's own INSERTs.
    const introduced = parsed
      .map((r) => r.code)
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

  it("keeps every follow-up migration on snake_case table names", () => {
    // A hand-written migration that says "TenantAddOn" takes 42P01 in
    // production and passes every test that runs against a db-push database.
    for (const f of followUps) {
      expect(executableSql(f)).not.toMatch(
        /"MarketplaceAddOn"|"TenantAddOn"|"Tenant"|"RenewalCycle"|"CheckoutIntent"|"AuditLog"/,
      );
    }
  });

  it("moves delivery ownership instead of stranding it at renewal", () => {
    // Archiving alone keeps the grant (the projector never reads the catalog
    // row's status) but silently drops the line from the renewal invoice:
    // RenewalCycleService builds the cart from owned codes, QuoteService drops
    // an unpublished row with "addon_not_purchasable", the sweeper expires the
    // ownership row, and addon-purchasability then BLOCKS buying the package
    // with ADDON_ALREADY_GRANTED. So ownership has to move.
    const exec = executableSql(readFileSync(BUNDLE_UP, "utf8"));
    expect(exec).toMatch(/UPDATE "tenant_addons"[\s\S]*SET "addOnId"/);
    expect(exec).toContain("'migratedFrom'");
    expect(exec).toMatch(/DELETE FROM "renewal_cycles"[\s\S]*'open'/);
  });

  it("guards the bundle up against in-flight checkout intents", () => {
    // A paid-but-unprovisioned intent names an archived SKU; settlement
    // re-quotes, the row drops out, the 1-kuruş tolerance blows and provision
    // is REFUSED with the card already charged (checkout.service.ts:233-243).
    // There is no automatic refund rail, so the migration must refuse to run.
    const exec = executableSql(readFileSync(BUNDLE_UP, "utf8"));
    expect(exec).toMatch(/"checkout_intents"[\s\S]*RAISE EXCEPTION/);
  });

  it("only deletes renewal cycles the 06:00 generator can rebuild", () => {
    // nextAnniversary() (anniversary.ts:114-121) jumps to NEXT year once today
    // >= the anniversary, so deleting an already-due open cycle destroys both
    // the invoice and the only trigger lapseUnpaidCycles has.
    const exec = executableSql(readFileSync(BUNDLE_UP, "utf8"));
    const del = exec.slice(exec.indexOf('DELETE FROM "renewal_cycles"'));
    expect(del).toMatch(/"anniversaryAt"\s*>\s*NOW\(\)/);
  });

  it("never deletes a marketplace_addons row from the bundle up", () => {
    expect(executableSql(readFileSync(BUNDLE_UP, "utf8"))).not.toMatch(
      /DELETE FROM "marketplace_addons"/,
    );
  });

  it("guards the bundle down's delete with a tenant_addons NOT EXISTS", () => {
    const down = executableSql(readFileSync(BUNDLE_DOWN, "utf8"));
    expect(down).toMatch(
      /DELETE FROM "marketplace_addons"[\s\S]*NOT EXISTS[\s\S]*"tenant_addons"/,
    );
  });

  it("restores the archived catalog rows to their stamped prior status", () => {
    // The down must NOT write 'published' unconditionally: the up only
    // archives rows that WERE published, so a row an operator archived before
    // the migration must not come back on sale. The stamp lives in audit_logs
    // because marketplace_addons has no free-form meta column.
    const up = executableSql(readFileSync(BUNDLE_UP, "utf8"));
    const down = executableSql(readFileSync(BUNDLE_DOWN, "utf8"));
    expect(up).toMatch(/INSERT INTO "audit_logs"[\s\S]*migratedPriorStatus/);
    expect(down).toContain("migratedPriorStatus");
    expect(down).not.toMatch(/SET "status" = 'published'/);
  });

  it("restores the dedupe timestamps instead of nulling them", () => {
    // A faithful inverse writes the pre-migration cancelledAt/endedAt back
    // from the stamp. The negative lookahead matters: NULLIF(...) legitimately
    // starts with NULL, and a bare /= NULL/ would flag the correct code.
    const down = executableSql(readFileSync(BUNDLE_DOWN, "utf8"));
    expect(down).toContain("migratedPriorCancelledAt");
    expect(down).toContain("migratedPriorEndedAt");
    expect(down).not.toMatch(/"cancelledAt"\s*=\s*NULL(?![A-Z])/);
  });
});
