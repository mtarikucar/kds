/**
 * v3.0.0 bootstrap — one-shot script run after the v3 schema migration
 * lands on a fresh DB. Idempotent: re-running is safe.
 *
 * Why this script and not a SQL backfill in the migration: the v3
 * schema's CHECK constraint requires WAITER/KITCHEN/COURIER users to
 * carry a primaryBranchId. A migration that inserts users (or that
 * leaves restricted users without a home branch) would fail. The
 * order is:
 *
 *   1. (Runbook) TRUNCATE all branch-scoped operational tables
 *      CASCADE. Fresh DB = no historical rows to backfill.
 *   2. Apply v3 migration (this commit's migration.sql).
 *   3. Run THIS script — creates a Main branch per tenant and stamps
 *      ADMIN.primaryBranchId. Restricted-role users are not created
 *      yet (registration is what creates them in v3 — the deploy
 *      runbook explicitly disables WAITER/KITCHEN/COURIER signups
 *      until per-tenant branches are seeded).
 *
 * Use: `npx ts-node backend/scripts/bootstrap-v3-tenants.ts`
 * or via the deploy runbook hook.
 */
import { PrismaClient } from '@prisma/client';

// Exported as a function (not module-load side effect) so the spec can
// call it with a mocked PrismaClient. The CLI entry point at the bottom
// calls runBootstrap() with a real client.
export async function ensureMainBranchForTenants(
  prisma: Pick<PrismaClient, 'tenant' | 'branch' | 'user'>,
): Promise<{ createdBranches: number; stampedAdmins: number }> {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, timezone: true, name: true },
  });

  let createdBranches = 0;
  let stampedAdmins = 0;

  for (const tenant of tenants) {
    const existing = await prisma.branch.findFirst({
      where: { tenantId: tenant.id, status: 'active' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    const mainBranchId =
      existing?.id ??
      (
        await prisma.branch.create({
          data: {
            tenantId: tenant.id,
            name: 'Main',
            timezone: tenant.timezone ?? 'UTC',
            status: 'active',
          },
          select: { id: true },
        })
      ).id;

    if (!existing) createdBranches++;

    const stamp = await prisma.user.updateMany({
      where: {
        tenantId: tenant.id,
        role: 'ADMIN',
        primaryBranchId: null,
      },
      data: { primaryBranchId: mainBranchId },
    });
    stampedAdmins += stamp.count;
  }

  return { createdBranches, stampedAdmins };
}

export async function verifyInvariants(
  prisma: Pick<PrismaClient, 'tenant' | 'user'>,
): Promise<void> {
  // Every tenant must end with ≥1 active branch.
  const orphanTenants = await prisma.tenant.findMany({
    where: {
      branches: {
        none: { status: 'active' },
      },
    },
    select: { id: true, name: true },
  });
  if (orphanTenants.length > 0) {
    throw new Error(
      `bootstrap-v3-tenants invariant violated: ${orphanTenants.length} tenant(s) ` +
        `have no active branch (${orphanTenants
          .slice(0, 5)
          .map((t) => `${t.name}:${t.id}`)
          .join(', ')}...).`,
    );
  }

  // No restricted user without primaryBranchId — DB CHECK already
  // enforces this, but verifying here gives a clearer error than the
  // first INSERT that trips the constraint.
  const restrictedOrphans = await prisma.user.count({
    where: {
      role: { in: ['WAITER', 'KITCHEN', 'COURIER'] },
      primaryBranchId: null,
    },
  });
  if (restrictedOrphans > 0) {
    throw new Error(
      `bootstrap-v3-tenants invariant violated: ${restrictedOrphans} restricted-role ` +
        `user(s) have no primaryBranchId.`,
    );
  }

  console.log('bootstrap-v3-tenants: invariants OK.');
}

export async function runBootstrap(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await ensureMainBranchForTenants(prisma);
    console.log(
      `bootstrap-v3-tenants: ${result.createdBranches} new Main branch(es) created; ` +
        `${result.stampedAdmins} ADMIN user(s) stamped with primaryBranchId.`,
    );
    await verifyInvariants(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

// CLI entry point — only fires when this file is executed directly.
if (require.main === module) {
  runBootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
