import { PrismaClient } from '../../../backend/node_modules/@prisma/client';

/**
 * Force the Sultanahmet demo tenant back onto its BUSINESS baseline.
 *
 * Plan-switching specs (subscription-lifecycle/*, plan-tier-matrix/*)
 * call forceDowngrade against the demo tenant to exercise their gates;
 * when their own afterAll cleanup is skipped (timeout, abort, retry),
 * the tenant lingers on a downgraded plan (PRO 50-table cap) and every
 * subsequent table/category-creating spec then 403s with
 * "limit reached" for reasons unrelated to the code under test.
 *
 * This helper restores `Subscription.planId` + `Tenant.currentPlanId`
 * to BUSINESS. It is a noop when the tenant is already on BUSINESS —
 * cheap enough to call from a per-test beforeEach.
 *
 * Implementation note: we go straight to Prisma rather than through
 * the superadmin HTTP endpoint. The HTTP path needs a 2FA-cached
 * SuperAdmin login, lists subscriptions, and PATCHes — three round
 * trips, frequently >1s under load and prone to timing-out the test
 * hook. Two indexed Prisma calls is more reliable.
 */

// Module-level singleton — Prisma's connect pool isn't free, and the
// test runner does a beforeEach per spec across 460 tests.
let _prisma: PrismaClient | null = null;
function client(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

export async function ensureDemoTenantOnBusiness(): Promise<void> {
  try {
    const prisma = client();
    const tenant = await prisma.tenant.findFirst({
      where: { subdomain: 'sultanahmet' },
      select: {
        id: true,
        currentPlanId: true,
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
          select: { id: true, planId: true },
          take: 1,
        },
      },
    });
    if (!tenant) return;

    const businessPlan = await prisma.subscriptionPlan.findUnique({
      where: { name: 'BUSINESS' },
      select: { id: true },
    });
    if (!businessPlan) return;

    // Fast path: tenant + sub both already pointing at BUSINESS, no
    // writes needed. The vast majority of beforeEach calls hit this.
    const sub = tenant.subscriptions[0];
    if (
      tenant.currentPlanId === businessPlan.id &&
      (!sub || sub.planId === businessPlan.id)
    ) {
      return;
    }

    const ops: Promise<unknown>[] = [];
    if (tenant.currentPlanId !== businessPlan.id) {
      ops.push(
        prisma.tenant.update({
          where: { id: tenant.id },
          data: { currentPlanId: businessPlan.id },
        }),
      );
    }
    if (sub && sub.planId !== businessPlan.id) {
      ops.push(
        prisma.subscription.update({
          where: { id: sub.id },
          data: { planId: businessPlan.id },
        }),
      );
    }
    await Promise.all(ops);
  } catch {
    // Best-effort — the spec itself will fail loud if the restore was
    // actually needed and didn't take.
  }
}

export async function disconnectDemoTenantHelper(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect().catch(() => undefined);
    _prisma = null;
  }
}
