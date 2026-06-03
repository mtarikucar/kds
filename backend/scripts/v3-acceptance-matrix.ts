/**
 * v3.0.0 acceptance matrix — closes the plan's 11-point staging
 * verification on a local Postgres instance.
 *
 * Run with: `npx ts-node scripts/v3-acceptance-matrix.ts`
 *
 * What it does:
 *
 *   1. Spins up a fresh database (`v3_acceptance`), drops + recreates.
 *   2. Applies the v3 migration via Prisma's CLI.
 *   3. Runs the bootstrap script idempotency cases against the empty
 *      schema (zero tenants, then with a hand-seeded multi-tenant set).
 *   4. Exercises the 11 architectural invariants the plan requires
 *      before flipping strict mode in production. Each invariant is
 *      asserted by raw SQL or by a Prisma write that MUST fail.
 *
 * Output: a green tick per passed invariant, a red cross + diagnostic
 * per failure. Process exits non-zero on any failure so CI can gate
 * on it.
 */
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import {
  ensureMainBranchForTenants,
  verifyInvariants,
} from '../src/common/scripts/bootstrap-v3-tenants';

const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ??
  // The admin DB just needs to exist so we can issue DROP/CREATE
  // against the test DB. `restaurant_pos` is the dev DB the rest of
  // this codebase uses; we never write to it from this script.
  'postgresql://tarik:Merhabalar06@localhost:5432/restaurant_pos?schema=public';
const TEST_DB = 'v3_acceptance';
const TEST_URL =
  `postgresql://tarik:Merhabalar06@localhost:5432/${TEST_DB}?schema=public`;

type Outcome = { name: string; ok: boolean; detail?: string };
const results: Outcome[] = [];

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${name}${detail ? `\n   ${detail}` : ''}`);
}

async function recreateDb() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    // Terminate any existing connections before dropping.
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
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
 * Apply the schema by `db push` (skips legacy migration history that
 * predates v3 work and isn't relevant to this acceptance run) and
 * then layer on the v3-specific raw SQL (CHECK constraint + compound
 * FK invariants — Prisma can't yet express either in its schema
 * grammar so the canonical migration ships them as appended SQL).
 */
function applyMigrations() {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: TEST_URL },
    stdio: 'inherit',
  });

  // Layer on the v3 invariants that live outside Prisma's schema
  // grammar. Idempotent: re-running is a no-op.
  const v3Sql = `
    DO $$ BEGIN
      ALTER TABLE "users" ADD CONSTRAINT "users_restricted_role_requires_primary_branch"
        CHECK (
          "role" NOT IN ('WAITER', 'KITCHEN', 'COURIER')
          OR "primaryBranchId" IS NOT NULL
        );
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      ALTER TABLE "reservations"
        ADD CONSTRAINT "reservations_tableId_branchId_fkey"
        FOREIGN KEY ("tableId", "branchId") REFERENCES "tables"("id", "branchId")
        ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      ALTER TABLE "orders"
        ADD CONSTRAINT "orders_tableId_branchId_fkey"
        FOREIGN KEY ("tableId", "branchId") REFERENCES "tables"("id", "branchId")
        ON DELETE SET NULL ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    -- Settings tables: enforce NULLS NOT DISTINCT (PG15+). db push
    -- creates the unique as a plain UNIQUE INDEX (not a CONSTRAINT),
    -- so we DROP INDEX and recreate with the modifier. Without this
    -- step two tenant-default rows for the same tenant would slip
    -- through and break the override pattern.
    DROP INDEX IF EXISTS "pos_settings_tenantId_branchId_key";
    CREATE UNIQUE INDEX "pos_settings_tenantId_branchId_key"
      ON "pos_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
    DROP INDEX IF EXISTS "qr_menu_settings_tenantId_branchId_key";
    CREATE UNIQUE INDEX "qr_menu_settings_tenantId_branchId_key"
      ON "qr_menu_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
    DROP INDEX IF EXISTS "reservation_settings_tenantId_branchId_key";
    CREATE UNIQUE INDEX "reservation_settings_tenantId_branchId_key"
      ON "reservation_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
    DROP INDEX IF EXISTS "sms_settings_tenantId_branchId_key";
    CREATE UNIQUE INDEX "sms_settings_tenantId_branchId_key"
      ON "sms_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
    DROP INDEX IF EXISTS "stock_settings_tenantId_branchId_key";
    CREATE UNIQUE INDEX "stock_settings_tenantId_branchId_key"
      ON "stock_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
    DROP INDEX IF EXISTS "accounting_settings_tenantId_branchId_key";
    CREATE UNIQUE INDEX "accounting_settings_tenantId_branchId_key"
      ON "accounting_settings"("tenantId", "branchId") NULLS NOT DISTINCT;
  `;

  return v3Sql;
}

async function applyV3RawSql(client: Client, sql: string) {
  await client.query(sql);
}

async function seedFixture(prisma: PrismaClient) {
  // Two tenants, one with two branches, one with one branch.
  // Each tenant has an ADMIN and the multi-branch tenant adds a
  // WAITER pinned to branch A.
  const tenantA = await prisma.tenant.create({
    data: { name: 'Acme Bistros', subdomain: 'acme', status: 'ACTIVE' },
  });
  const tenantB = await prisma.tenant.create({
    data: { name: 'Bravo Cafes', subdomain: 'bravo', status: 'ACTIVE' },
  });

  const branchA1 = await prisma.branch.create({
    data: { tenantId: tenantA.id, name: 'Main', status: 'active' },
  });
  const branchA2 = await prisma.branch.create({
    data: { tenantId: tenantA.id, name: 'Second', status: 'active' },
  });
  const branchB1 = await prisma.branch.create({
    data: { tenantId: tenantB.id, name: 'Main', status: 'active' },
  });

  const adminA = await prisma.user.create({
    data: {
      email: 'admin@acme.test',
      password: 'x',
      firstName: 'A',
      lastName: 'A',
      role: 'ADMIN',
      status: 'ACTIVE',
      tenantId: tenantA.id,
      primaryBranchId: branchA1.id,
    },
  });

  const waiterA = await prisma.user.create({
    data: {
      email: 'waiter@acme.test',
      password: 'x',
      firstName: 'W',
      lastName: 'A',
      role: 'WAITER',
      status: 'ACTIVE',
      tenantId: tenantA.id,
      primaryBranchId: branchA1.id,
    },
  });

  await prisma.user.create({
    data: {
      email: 'admin@bravo.test',
      password: 'x',
      firstName: 'B',
      lastName: 'B',
      role: 'ADMIN',
      status: 'ACTIVE',
      tenantId: tenantB.id,
      primaryBranchId: branchB1.id,
    },
  });

  // One table per branch so the compound FK invariants can be exercised.
  const tableA1 = await prisma.table.create({
    data: {
      tenantId: tenantA.id,
      branchId: branchA1.id,
      number: '1',
      capacity: 4,
    },
  });
  const tableA2 = await prisma.table.create({
    data: {
      tenantId: tenantA.id,
      branchId: branchA2.id,
      number: '2',
      capacity: 4,
    },
  });

  return {
    tenantA,
    tenantB,
    branchA1,
    branchA2,
    branchB1,
    adminA,
    waiterA,
    tableA1,
    tableA2,
  };
}

async function expectThrow(
  label: string,
  fn: () => Promise<unknown>,
  errorMatch?: RegExp,
) {
  try {
    await fn();
    record(label, false, 'expected an error but the call succeeded');
  } catch (err: any) {
    if (errorMatch && !errorMatch.test(err.message)) {
      record(label, false, `error didn't match ${errorMatch}: ${err.message}`);
      return;
    }
    record(label, true, `→ ${err.message.split('\n')[0].slice(0, 140)}`);
  }
}

async function main() {
  console.log('--- v3.0.0 acceptance matrix ---');
  console.log('1. Recreating fresh database…');
  await recreateDb();
  console.log('2. Applying schema + v3 invariants…');
  const v3Sql = applyMigrations();

  // Apply the v3 raw-SQL invariants (CHECK + compound FK +
  // NULLS NOT DISTINCT). Done over a direct pg client to avoid
  // Prisma's "this isn't part of a migration" warning.
  const sqlClient = new Client({ connectionString: TEST_URL });
  await sqlClient.connect();
  try {
    await applyV3RawSql(sqlClient, v3Sql as string);
  } finally {
    await sqlClient.end();
  }

  console.log('3. Running invariant matrix…\n');

  const prisma = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  try {
    // Invariant #1: bootstrap is silent on an empty DB.
    const result = await ensureMainBranchForTenants(prisma);
    record(
      'bootstrap on empty DB does nothing',
      result.createdBranches === 0 && result.stampedAdmins === 0,
      `created=${result.createdBranches}, stamped=${result.stampedAdmins}`,
    );

    const fix = await seedFixture(prisma);

    // Invariant #2: bootstrap is idempotent on a tenant that already
    // has a Main branch + ADMIN primaryBranchId.
    const second = await ensureMainBranchForTenants(prisma);
    record(
      'bootstrap idempotency on seeded tenants',
      second.createdBranches === 0,
      `(no new branches, second.stampedAdmins=${second.stampedAdmins})`,
    );

    // Invariant #3: verifyInvariants passes when every tenant has a
    // Main branch + WAITER/KITCHEN/COURIER carries primaryBranchId.
    try {
      await verifyInvariants(prisma);
      record('verifyInvariants passes on seeded tenants', true);
    } catch (err: any) {
      record('verifyInvariants passes on seeded tenants', false, err.message);
    }

    // Invariant #4: DB CHECK constraint refuses a WAITER without
    // primaryBranchId.
    await expectThrow(
      'CHECK refuses WAITER with null primaryBranchId',
      () =>
        prisma.user.create({
          data: {
            email: 'no-home@acme.test',
            password: 'x',
            firstName: 'X',
            lastName: 'X',
            role: 'WAITER',
            status: 'ACTIVE',
            tenantId: fix.tenantA.id,
            primaryBranchId: null,
          },
        }),
      /restricted_role_requires_primary_branch|primary.*branch|check constraint/i,
    );

    // Invariant #5: a KITCHEN user without primaryBranchId is also
    // refused.
    await expectThrow(
      'CHECK refuses KITCHEN with null primaryBranchId',
      () =>
        prisma.user.create({
          data: {
            email: 'kitchen-no-home@acme.test',
            password: 'x',
            firstName: 'X',
            lastName: 'X',
            role: 'KITCHEN',
            status: 'ACTIVE',
            tenantId: fix.tenantA.id,
            primaryBranchId: null,
          },
        }),
      /restricted_role_requires_primary_branch|primary.*branch|check constraint/i,
    );

    // Invariant #6: an Order created with a (tableId, branchId) pair
    // where branchId doesn't match the table's actual branch is
    // refused by the compound FK.
    await expectThrow(
      'compound FK refuses cross-branch Order(tableId, branchId)',
      () =>
        prisma.order.create({
          data: {
            orderNumber: randomUUID(),
            tenantId: fix.tenantA.id,
            // tableA1 lives on branchA1; we're trying to point it at A2.
            tableId: fix.tableA1.id,
            branchId: fix.branchA2.id,
            type: 'DINE_IN',
            status: 'PENDING',
            totalAmount: 10,
            finalAmount: 10,
            userId: fix.adminA.id,
          },
        }),
      /foreign key|constraint|violates/i,
    );

    // Invariant #7: an Order with a matching (tableId, branchId) pair
    // is accepted.
    let happyOrderId: string | null = null;
    try {
      const order = await prisma.order.create({
        data: {
          orderNumber: randomUUID(),
          tenantId: fix.tenantA.id,
          tableId: fix.tableA1.id,
          branchId: fix.branchA1.id,
          type: 'DINE_IN',
          status: 'PENDING',
          totalAmount: 10,
          finalAmount: 10,
          userId: fix.adminA.id,
        },
      });
      happyOrderId = order.id;
      record('matching (tableId, branchId) Order is accepted', true);
    } catch (err: any) {
      record('matching (tableId, branchId) Order is accepted', false, err.message);
    }

    // Invariant #8: FK Restrict blocks the deletion of a branch with
    // operational rows.
    if (happyOrderId) {
      await expectThrow(
        'FK Restrict blocks branch delete when orders exist',
        () =>
          prisma.branch.delete({ where: { id: fix.branchA1.id } }),
        /foreign key|constraint|violates/i,
      );
    }

    // Invariant #9: settings tables enforce the (tenantId, branchId)
    // compound unique with NULLS NOT DISTINCT — two NULL-branch rows
    // for the same tenant are refused.
    await prisma.posSettings.create({
      data: {
        tenantId: fix.tenantA.id,
        branchId: null,
        enableTablelessMode: false,
        enableTwoStepCheckout: true,
        enableCustomerOrdering: true,
      },
    });
    await expectThrow(
      'compound unique (NULLS NOT DISTINCT) refuses duplicate tenant default',
      () =>
        prisma.posSettings.create({
          data: {
            tenantId: fix.tenantA.id,
            branchId: null,
            enableTablelessMode: false,
            enableTwoStepCheckout: true,
            enableCustomerOrdering: true,
          },
        }),
      /unique|duplicate/i,
    );

    // Invariant #10: settings override row coexists with the
    // tenant-default row on the same tenant.
    try {
      await prisma.posSettings.create({
        data: {
          tenantId: fix.tenantA.id,
          branchId: fix.branchA1.id,
          enableTablelessMode: true,
          enableTwoStepCheckout: true,
          enableCustomerOrdering: true,
        },
      });
      record('per-branch override coexists with tenant-default', true);
    } catch (err: any) {
      record('per-branch override coexists with tenant-default', false, err.message);
    }

    // Invariant #11: UserBranchAssignment unique (userId, branchId)
    // enforces dedup.
    await prisma.userBranchAssignment.create({
      data: {
        userId: fix.adminA.id,
        branchId: fix.branchA2.id,
        tenantId: fix.tenantA.id,
      },
    });
    await expectThrow(
      'UserBranchAssignment unique (userId, branchId) refuses duplicate',
      () =>
        prisma.userBranchAssignment.create({
          data: {
            userId: fix.adminA.id,
            branchId: fix.branchA2.id,
            tenantId: fix.tenantA.id,
          },
        }),
      /unique|duplicate/i,
    );
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n--- summary ---');
  const failures = results.filter((r) => !r.ok);
  console.log(`${results.length - failures.length}/${results.length} invariants green`);
  if (failures.length > 0) {
    console.log('Failed:');
    for (const f of failures) console.log(`  - ${f.name}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
