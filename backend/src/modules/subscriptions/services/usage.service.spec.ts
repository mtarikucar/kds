import { NotFoundException } from '@nestjs/common';
import { UsageService } from './usage.service';

/**
 * v2.8.88 — UsageService snapshot regression.
 *
 * Snapshot is read by the Plan & Erişim page and the dashboard quota
 * mini-cards. The contract:
 *   - `current` is a tenant-scoped count (active users / branches /
 *     products / current-month orders).
 *   - `max` is the engine-resolved limit; -1 means unlimited per the
 *     engine convention.
 *   - Engine miss → falls back to plan row maxima so the snapshot
 *     still renders during projector races.
 *   - 60s cache per tenant — second call doesn't hit Prisma.
 */
describe('UsageService.getSnapshot (v2.8.88)', () => {
  let prisma: any;
  let entitlements: any;
  let svc: UsageService;

  const tenantId = 't-1';

  beforeEach(() => {
    prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ id: tenantId }),
      },
      user: { count: jest.fn().mockResolvedValue(3) },
      branch: { count: jest.fn().mockResolvedValue(2) },
      product: { count: jest.fn().mockResolvedValue(48) },
      order: { count: jest.fn().mockResolvedValue(122) },
    };
    entitlements = {
      getForTenant: jest.fn().mockResolvedValue({
        features: {},
        limits: {
          'limit.maxUsers': 15,
          'limit.maxProducts': 500,
          'limit.maxMonthlyOrders': 5000,
          'limit.maxBranches': 3, // from extra_branch ×2 add-ons
        },
        integrations: {},
        computedAt: new Date().toISOString(),
      }),
    };
    svc = new UsageService(prisma, entitlements);
  });

  it('returns current usage paired with engine-resolved limits', async () => {
    const snap = await svc.getSnapshot(tenantId);
    expect(snap.users).toEqual({ current: 3, max: 15 });
    expect(snap.branches).toEqual({ current: 2, max: 3 });
    expect(snap.products).toEqual({ current: 48, max: 500 });
    expect(snap.monthlyOrders).toEqual({ current: 122, max: 5000 });
    expect(snap.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('caches per-tenant for 60s — second call skips Prisma + engine', async () => {
    await svc.getSnapshot(tenantId);
    expect(prisma.user.count).toHaveBeenCalledTimes(1);
    expect(entitlements.getForTenant).toHaveBeenCalledTimes(1);

    await svc.getSnapshot(tenantId);
    expect(prisma.user.count).toHaveBeenCalledTimes(1);
    expect(entitlements.getForTenant).toHaveBeenCalledTimes(1);
  });

  it('falls back to plan row when engine returns empty (projector race)', async () => {
    entitlements.getForTenant.mockResolvedValue({
      features: {},
      limits: {},
      integrations: {},
      computedAt: new Date(0).toISOString(),
    });
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      currentPlan: {
        maxUsers: 5,
        maxProducts: 100,
        maxMonthlyOrders: 1000,
      },
    });
    const snap = await svc.getSnapshot(tenantId);
    expect(snap.users.max).toBe(5);
    expect(snap.products.max).toBe(100);
    expect(snap.monthlyOrders.max).toBe(1000);
    expect(snap.branches.max).toBe(1); // default when no grant
  });

  it('throws NotFound when tenant missing', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    await expect(svc.getSnapshot(tenantId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('counts only ACTIVE users (status filter applied)', async () => {
    await svc.getSnapshot(tenantId);
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { tenantId, status: 'ACTIVE' },
    });
  });

  it('current-month orders bound at start of calendar month', async () => {
    await svc.getSnapshot(tenantId);
    const args = prisma.order.count.mock.calls[0][0];
    expect(args.where.createdAt.gte).toBeInstanceOf(Date);
    const start = args.where.createdAt.gte as Date;
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
  });

  it('invalidate() drops the cache on the next call', async () => {
    await svc.getSnapshot(tenantId);
    svc.invalidate(tenantId);
    await svc.getSnapshot(tenantId);
    expect(prisma.user.count).toHaveBeenCalledTimes(2);
  });
});
