import { EntitlementService } from './entitlement.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Read/write + cache invariants for EntitlementService.
 *
 * The in-process cache is a hot path — every authed request hits it via
 * the guard. These tests pin the three things that must always hold:
 *   1. consecutive reads return from cache (single DB hit)
 *   2. setGrantsForSource invalidates the tenant's cache entry
 *   3. revokeSource invalidates the tenant's cache entry
 *   4. an empty-input shortcut never reads the DB
 */
describe('EntitlementService', () => {
  let prisma: MockPrismaClient;
  let svc: EntitlementService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new EntitlementService(prisma as any);
  });

  it('shortcuts to the empty set when tenantId is missing', async () => {
    const set = await svc.getForTenant('');
    expect(set.features).toEqual({});
    expect(prisma.featureEntitlement.findMany).not.toHaveBeenCalled();
  });

  it('caches read results — second call does not hit the DB', async () => {
    (prisma.featureEntitlement.findMany as any).mockResolvedValue([
      { tenantId: 't1', branchId: null, scope: 'tenant', key: 'feature.kds', value: true, source: 'plan:PRO', validUntil: null },
    ]);

    const a = await svc.getForTenant('t1');
    const b = await svc.getForTenant('t1');

    expect(a.features['feature.kds']).toBe(true);
    expect(b.features['feature.kds']).toBe(true);
    expect(prisma.featureEntitlement.findMany).toHaveBeenCalledTimes(1);
  });

  it('caches per (tenant, branch) — different branchId triggers a fresh read', async () => {
    (prisma.featureEntitlement.findMany as any).mockResolvedValue([]);
    await svc.getForTenant('t1', null);
    await svc.getForTenant('t1', 'b-1');
    await svc.getForTenant('t1', 'b-2');
    expect(prisma.featureEntitlement.findMany).toHaveBeenCalledTimes(3);
  });

  it('invalidate() drops the cache so the next read re-queries the DB', async () => {
    (prisma.featureEntitlement.findMany as any).mockResolvedValue([]);

    await svc.getForTenant('t1');
    expect(prisma.featureEntitlement.findMany).toHaveBeenCalledTimes(1);

    svc.invalidate('t1');

    await svc.getForTenant('t1');
    expect(prisma.featureEntitlement.findMany).toHaveBeenCalledTimes(2);
  });

  it('invalidate() targets one tenant — other tenants stay cached', async () => {
    (prisma.featureEntitlement.findMany as any).mockResolvedValue([]);
    await svc.getForTenant('t1');
    await svc.getForTenant('t2');
    expect(prisma.featureEntitlement.findMany).toHaveBeenCalledTimes(2);

    svc.invalidate('t1');

    await svc.getForTenant('t1');   // re-reads
    await svc.getForTenant('t2');   // still cached
    expect(prisma.featureEntitlement.findMany).toHaveBeenCalledTimes(3);
  });

  it('setGrantsForSource invalidates the tenant cache', async () => {
    (prisma.featureEntitlement.findMany as any).mockResolvedValue([]);
    (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
    (prisma.featureEntitlement.deleteMany as any).mockResolvedValue({ count: 0 });
    (prisma.featureEntitlement.createMany as any).mockResolvedValue({ count: 0 });

    await svc.getForTenant('t1');                            // populate cache
    await svc.setGrantsForSource('t1', 'plan:PRO', []);      // mutating call

    // Verify the cache was actually cleared by triggering another read.
    await svc.getForTenant('t1');
    expect(prisma.featureEntitlement.findMany).toHaveBeenCalledTimes(2);
  });

  it('revokeSource invalidates the tenant cache', async () => {
    (prisma.featureEntitlement.findMany as any).mockResolvedValue([]);
    (prisma.featureEntitlement.deleteMany as any).mockResolvedValue({ count: 1 });

    await svc.getForTenant('t1');
    await svc.revokeSource('t1', 'plan:BASIC');
    await svc.getForTenant('t1');
    expect(prisma.featureEntitlement.findMany).toHaveBeenCalledTimes(2);
  });

  it('filters out grants past their validUntil at read time', async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    (prisma.featureEntitlement.findMany as any).mockResolvedValue([
      { tenantId: 't1', branchId: null, scope: 'tenant', key: 'feature.kds', value: true, source: 'grace:past-due', validUntil: past },
      { tenantId: 't1', branchId: null, scope: 'tenant', key: 'feature.api', value: true, source: 'grace:past-due', validUntil: future },
    ]);
    const set = await svc.getForTenant('t1');
    expect(set.features['feature.kds']).toBeUndefined();
    expect(set.features['feature.api']).toBe(true);
  });
});
