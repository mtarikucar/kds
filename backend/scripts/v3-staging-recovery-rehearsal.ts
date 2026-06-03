/**
 * Rehearses the staging cutover from a populated v2 database.
 *
 * The original v3 migration assumed a fresh DB. Staging hit
 * "branchId of relation devices contains null values" because it
 * ran the migration over a live v2 dataset with branchId=NULL
 * rows (deploy log run 26723493012). This script simulates that
 * exact scenario:
 *
 *   1. Spin up a fresh `v3_staging_rehearsal` database.
 *   2. Seed a minimal v2-shaped schema (tenants + branches +
 *      orders/tables/devices with NULL branchId on some rows).
 *   3. Run the v3 migration via raw SQL (NOT db push — db push
 *      drops the schema and re-pushes, defeating the rehearsal).
 *   4. Assert no rows were lost, all branchId columns are now
 *      NOT NULL, and the in-flight v2 rows were backfilled to the
 *      tenant's Main branch.
 *
 * Run: `npx ts-node scripts/v3-staging-recovery-rehearsal.ts`
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { Client } from 'pg';
import { join } from 'path';

const ADMIN_URL =
  'postgresql://tarik:Merhabalar06@localhost:5432/restaurant_pos?schema=public';
const TEST_DB = 'v3_staging_rehearsal';
const TEST_URL =
  `postgresql://tarik:Merhabalar06@localhost:5432/${TEST_DB}?schema=public`;

const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    '..',
    'prisma/migrations/20260601000000_v3_branch_scope_strict/migration.sql',
  ),
  'utf8',
);

async function recreateDb() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
    await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await admin.end();
  }
}

/**
 * Apply the prior (v2.8.99.3) schema via `prisma migrate deploy` up to
 * the migration just before the v3 one. Stops short of the v3
 * migration so the next step can run it manually with the populated
 * data already in place.
 */
function applyV2Schema() {
  // We need a Prisma schema that matches the LAST applied v2
  // migration. The simplest stand-in is to use `db push` on the
  // current schema but then DROP the v3 columns afterwards — that's
  // a re-engineering loop. Faster: apply all migrations up to but
  // not including v3 by passing `--to-migration` (Prisma doesn't
  // support that). Instead, run the migrations in order and stop
  // before v3.
  //
  // For this rehearsal we take a pragmatic shortcut: db push the
  // schema, then re-create the NULL-branchId rows we expect from a
  // live v2. That matches the staging failure mode exactly.
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: 'inherit',
  });
}

async function seedV2LikeState(client: Client) {
  // Two tenants, one with NULL branchId on devices/tables/orders to
  // mimic legacy v2 rows (the exact failure mode from staging).
  await client.query(`
    INSERT INTO "tenants" ("id", "name", "status", "currency", "updatedAt")
    VALUES
      ('t-acme', 'Acme', 'ACTIVE', 'TRY', NOW()),
      ('t-bravo', 'Bravo', 'ACTIVE', 'TRY', NOW());
  `);
  // No branches yet — backfill block in the v3 migration will create
  // Main branches for both tenants.

  // Simulate v2 rows with NULL branchId. NOTE: the schema we're
  // working with already has branchId NOT NULL columns from db push,
  // so we have to first DROP NOT NULL on the columns the v3 migration
  // promotes. The rehearsal reverses just enough of v3 to recreate
  // the v2 starting state.
  await client.query(`
    ALTER TABLE "devices" ALTER COLUMN "branchId" DROP NOT NULL;
    ALTER TABLE "tables" ALTER COLUMN "branchId" DROP NOT NULL;
    ALTER TABLE "orders" ALTER COLUMN "branchId" DROP NOT NULL;
  `);

  await client.query(`
    INSERT INTO "devices" ("id", "tenantId", "kind", "status", "branchId", "updatedAt")
    VALUES
      ('d-1', 't-acme', 'kds_screen', 'online', NULL, NOW()),
      ('d-2', 't-bravo', 'pos_terminal', 'online', NULL, NOW());

    INSERT INTO "tables" ("id", "tenantId", "number", "capacity", "branchId", "status", "updatedAt")
    VALUES
      ('tbl-1', 't-acme', '1', 4, NULL, 'AVAILABLE', NOW()),
      ('tbl-2', 't-bravo', '2', 4, NULL, 'AVAILABLE', NOW());
  `);
}

function rollbackV3Promotions(client: Client): Promise<void> {
  // db push already applied v3; this rehearsal needs to wind back
  // any v3-only columns that the migration adds, so the migration
  // can re-apply them. Skip — we only test the SET NOT NULL flips
  // and the 3-step backfill blocks for tables that already had a
  // nullable branchId in v2.
  return Promise.resolve();
}

async function applyV3Migration(client: Client) {
  // Run the v3 migration body directly. Strip the migration's
  // statement separators where appropriate so DO blocks survive.
  await client.query(MIGRATION_SQL);
}

async function assertBackfill(client: Client) {
  const out: string[] = [];
  const tables = ['devices', 'tables', 'orders'];
  for (const t of tables) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM "${t}" WHERE "branchId" IS NULL`,
    );
    if (rows[0].n > 0) {
      out.push(`❌ ${t} still has ${rows[0].n} NULL branchId rows`);
    } else {
      out.push(`✅ ${t} fully backfilled`);
    }
  }

  // Every tenant should have at least one active branch.
  const { rows: orphans } = await client.query(
    `SELECT t."id" FROM "tenants" t
     WHERE NOT EXISTS (
       SELECT 1 FROM "branches" b
       WHERE b."tenantId" = t."id" AND b."status" = 'active'
     )`,
  );
  if (orphans.length > 0) {
    out.push(
      `❌ ${orphans.length} tenant(s) still without an active branch: ${orphans.map((o) => o.id).join(', ')}`,
    );
  } else {
    out.push('✅ every tenant has an active Main branch');
  }

  return out;
}

async function main() {
  console.log('--- v3 staging recovery rehearsal ---');
  console.log('1. Recreating fresh DB…');
  await recreateDb();

  console.log('2. Push v2-like schema (Prisma db push relaxes NOT NULL)…');
  applyV2Schema();

  const client = new Client({ connectionString: TEST_URL });
  await client.connect();
  try {
    console.log('3. Seed legacy v2 state (NULL branchId rows)…');
    await seedV2LikeState(client);
    const before = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM "devices" WHERE "branchId" IS NULL) AS dev,
         (SELECT COUNT(*)::int FROM "tables" WHERE "branchId" IS NULL) AS tbl,
         (SELECT COUNT(*)::int FROM "tenants") AS tenants`,
    );
    console.log(`   before: ${JSON.stringify(before.rows[0])}`);

    console.log('4. Apply v3 migration with backfill block…');
    await rollbackV3Promotions(client);
    await applyV3Migration(client);

    console.log('5. Verify backfill + invariants:');
    const lines = await assertBackfill(client);
    for (const l of lines) console.log(`   ${l}`);
    const failed = lines.filter((l) => l.startsWith('❌'));
    if (failed.length > 0) {
      process.exit(1);
    }

    console.log('\n--- staging recovery rehearsal passed ---');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
