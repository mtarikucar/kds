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

  /**
   * Iter-75 regression — cache eviction. The Map used to grow without
   * bound. Every getForTenant inserted an entry; nothing evicted it
   * unless invalidate() fired for that tenant. With 10K registered
   * tenants and natural churn (most inactive at any given moment),
   * stale entries would pin forever on every replica.
   *
   * Two layers: a per-write size cap (oldest-by-insertion eviction
   * after expired sweep) and a periodic timer that prunes expired
   * entries when reads are idle.
   */
  describe('iter-75 cache eviction', () => {
    it('hydrates fresh on first read, serves from cache on second', async () => {
      // baseline + sanity that the cache still functions after iter-75
      (prisma.featureEntitlement.findMany as any).mockResolvedValue([]);
      await svc.getForTenant('t-x');
      await svc.getForTenant('t-x');
      expect(prisma.featureEntitlement.findMany).toHaveBeenCalledTimes(1);
    });

    it('evicts oldest entries when the cache crosses MAX_CACHE_SIZE', async () => {
      (prisma.featureEntitlement.findMany as any).mockResolvedValue([]);
      // Slam in enough distinct tenant ids to push past the cap.
      const MAX = (EntitlementService as any).MAX_CACHE_SIZE as number;
      // We'll go ~5 over the cap to verify multiple evictions, not just one.
      const N = MAX + 5;
      for (let i = 0; i < N; i++) {
        await svc.getForTenant(`tenant-${i}`);
      }
      const cacheSize = (svc as any).cache.size as number;
      expect(cacheSize).toBeLessThanOrEqual(MAX);
      // The earliest-written tenant must have been evicted — re-reading
      // hits the DB again (which is exactly the LRU-ish contract).
      const findManyCalls = (prisma.featureEntitlement.findMany as any).mock.calls.length;
      await svc.getForTenant('tenant-0');
      const findManyAfter = (prisma.featureEntitlement.findMany as any).mock.calls.length;
      expect(findManyAfter).toBe(findManyCalls + 1);
    });

    it('sweepExpiredCache (private) drops only entries past their TTL', async () => {
      (prisma.featureEntitlement.findMany as any).mockResolvedValue([]);
      // Seed two entries with the public API, then poison one entry's
      // expiry so the sweep finds something to clean.
      await svc.getForTenant('t-a');
      await svc.getForTenant('t-b');
      const cache = (svc as any).cache as Map<string, { set: any; expiresAt: number }>;
      const aKey = [...cache.keys()].find((k) => k.startsWith('t-a::'))!;
      cache.get(aKey)!.expiresAt = Date.now() - 1; // expired

      const evicted = (svc as any).sweepExpiredCache() as number;

      expect(evicted).toBe(1);
      expect(cache.has(aKey)).toBe(false);
    });
  });
});
