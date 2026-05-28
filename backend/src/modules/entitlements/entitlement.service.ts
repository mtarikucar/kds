import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { fold } from './entitlement-engine';
import {
  EMPTY_ENTITLEMENT_SET,
  EntitlementGrant,
  EntitlementSet,
  EntitlementValue,
} from './entitlement.types';
import { EntitlementInvalidationBus } from './entitlement-invalidation.bus';

/**
 * Read & write side of the entitlement engine.
 *
 * Reads are heavy: every authed request may evaluate guards, so the computed
 * set is cached in-process per tenant for 30s. The Redis-backed invalidation
 * bus (EntitlementInvalidationBus) fans out cache-drop messages to peer
 * replicas in milliseconds, so a mutation on Pod A is visible on Pod B
 * effectively immediately — the 30s TTL is the fail-safe, not the primary
 * mechanism.
 *
 * Writes are append-or-replace upserts keyed by (tenant, branch, key, source)
 * so reprojecting a plan is idempotent and revocation is precise — removing
 * one source never touches another's grants.
 */
@Injectable()
export class EntitlementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EntitlementService.name);
  private readonly cache = new Map<string, { set: EntitlementSet; expiresAt: number }>();
  private readonly cacheTtlMs = 30_000;

  // Iter-75 — cache eviction. The Map is keyed by `${tenantId}::${branchId}`
  // and every authed request that lands on EntitlementGuard inserts an
  // entry on miss. With nothing to evict it, a fleet of 10K registered
  // tenants (90% inactive on any given day) keeps 9K stale entries pinned
  // on every API replica forever. Two layers:
  //
  //  1. Per-write cap. Any insert that pushes the map above MAX_CACHE_SIZE
  //     first sweeps expired entries; if still over the cap, drops the
  //     oldest by insertion order (JS Maps preserve insertion order, so
  //     iterating keys returns them oldest-first — effectively LRU when
  //     we re-insert on every hit). Bounded memory regardless of
  //     load shape.
  //
  //  2. Periodic sweep (60s) to evict expired entries when reads are
  //     idle — a tenant that hits once then disappears would otherwise
  //     keep its slot until the cap pushes it out. Light enough to run
  //     in-process without a separate scheduler.
  private static readonly MAX_CACHE_SIZE = 10_000;
  private static readonly CACHE_SWEEP_INTERVAL_MS = 60_000;
  private cacheSweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    // Optional so tests that construct EntitlementService standalone don't
    // need to wire the bus. Production module DI provides the real bus.
    @Optional() private readonly invalidationBus?: EntitlementInvalidationBus,
  ) {}

  onModuleInit(): void {
    // Register the local cache-drop callback with the bus. When a peer
    // replica publishes an invalidation, we drop our own cache for that
    // tenant — without publishing again (the bus filters by senderId).
    this.invalidationBus?.registerListener((tenantId) => this.invalidateLocal(tenantId));

    // Periodic eviction. `unref` so the timer doesn't keep the Node
    // process alive past shutdown.
    this.cacheSweepTimer = setInterval(
      () => this.sweepExpiredCache(),
      EntitlementService.CACHE_SWEEP_INTERVAL_MS,
    );
    this.cacheSweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.cacheSweepTimer) {
      clearInterval(this.cacheSweepTimer);
      this.cacheSweepTimer = null;
    }
  }

  /**
   * Drop every cache entry whose TTL has passed. Cheap when the cache is
   * mostly hot — the iteration is O(n) but the per-entry check is a
   * single integer compare. Called from the periodic timer above and
   * from setCacheEntry when it needs to make room.
   */
  private sweepExpiredCache(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [k, v] of this.cache.entries()) {
      if (v.expiresAt <= now) {
        this.cache.delete(k);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.logger.debug(`Swept ${evicted} expired entitlement cache entries`);
    }
    return evicted;
  }

  /**
   * Cap-aware cache write. Sweeps expired entries first; if still over
   * the cap, drops the oldest by insertion order until under. Maps
   * preserve insertion order in JS, so the first key returned by
   * `keys()` is the oldest written — re-writing a cache hit by calling
   * `delete` then `set` (the natural pattern of cache.set on every
   * read miss) keeps the order LRU-ish.
   */
  private setCacheEntry(key: string, value: { set: EntitlementSet; expiresAt: number }): void {
    // Re-set on existing key updates insertion order if we delete first.
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, value);
    if (this.cache.size > EntitlementService.MAX_CACHE_SIZE) {
      this.sweepExpiredCache();
      while (this.cache.size > EntitlementService.MAX_CACHE_SIZE) {
        const oldest = this.cache.keys().next().value;
        if (!oldest) break;
        this.cache.delete(oldest);
      }
    }
  }

  /** Read the effective entitlement set for a tenant. Cached. */
  async getForTenant(tenantId: string, branchId: string | null = null): Promise<EntitlementSet> {
    if (!tenantId) return EMPTY_ENTITLEMENT_SET;

    const cacheKey = `${tenantId}::${branchId ?? '-'}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.set;

    // Pull every grant for the tenant that *could* apply to this scope:
    // tenant-wide rows always do; branch-scoped rows only when the caller
    // asked about a specific branch. Expiry is checked in the app layer
    // below to keep this query index-friendly.
    const branchClause = branchId
      ? { OR: [{ branchId: null }, { branchId }] }
      : { branchId: null };
    const rows = await this.prisma.featureEntitlement.findMany({
      where: { tenantId, ...branchClause },
    });

    // Filter expired in app layer (the partial index keeps the DB cheap; we
    // still want a strict "as of now" view).
    const now = new Date();
    const grants: EntitlementGrant[] = rows
      .filter((r) => !r.validUntil || r.validUntil > now)
      .map((r) => ({
        tenantId: r.tenantId,
        branchId: r.branchId,
        scope: (r.scope as 'tenant' | 'branch' | 'device') ?? 'tenant',
        key: r.key,
        value: r.value as EntitlementValue,
        source: r.source,
        validUntil: r.validUntil,
      }));

    const set = fold(grants, now);
    this.setCacheEntry(cacheKey, { set, expiresAt: Date.now() + this.cacheTtlMs });
    return set;
  }

  /**
   * Force a refresh on next read across the fleet.
   *
   * Two-step: drop our local cache, then publish so peer replicas drop
   * theirs. Tests and the in-process listener call `invalidateLocal`
   * directly to avoid feedback loops.
   */
  invalidate(tenantId: string): void {
    this.invalidateLocal(tenantId);
    // Best-effort fan-out. The bus is a no-op when Redis is unconfigured;
    // the 30s TTL keeps eventual consistency intact.
    this.invalidationBus?.publish(tenantId).catch(() => undefined);
  }

  /** Drop only this replica's cache — used by the bus listener and tests. */
  private invalidateLocal(tenantId: string): void {
    for (const k of this.cache.keys()) {
      if (k.startsWith(`${tenantId}::`)) this.cache.delete(k);
    }
  }

  /**
   * Replace all grants for one (tenant, source) with the given set.
   *
   * This is the primary write path used by projectors (plan, add-on, override).
   * It deletes anything previously written by that source for the tenant and
   * inserts the new rows in one transaction so partial state can never be
   * observed by a concurrent reader.
   */
  async setGrantsForSource(
    tenantId: string,
    source: string,
    grants: ReadonlyArray<Omit<EntitlementGrant, 'tenantId' | 'source'>>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.setGrantsForSourceTx(tx, tenantId, source, grants);
    });
    this.invalidate(tenantId);
    this.logger.debug(`Reprojected source=${source} tenant=${tenantId} grants=${grants.length}`);
  }

  /**
   * Iter-76: transactional variant of setGrantsForSource. Same write
   * contract, but runs inside a caller-supplied tx client and does NOT
   * invalidate the cache (the caller does that after the outer txn
   * commits). PlanProjectorService uses this to atomically replace
   * multiple sources for one tenant — without sharing the txn boundary
   * the projector's "delete stale plan:* / write new plan:X" pair
   * leaves a window where BOTH the old and new plan's grants are
   * visible. Limits SUM, so e.g. BASIC.maxUsers=5 + PRO.maxUsers=20
   * briefly looks like 25 users allowed.
   */
  async setGrantsForSourceTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    source: string,
    grants: ReadonlyArray<Omit<EntitlementGrant, 'tenantId' | 'source'>>,
  ): Promise<void> {
    await tx.featureEntitlement.deleteMany({ where: { tenantId, source } });
    if (grants.length === 0) return;
    await tx.featureEntitlement.createMany({
      data: grants.map((g) => ({
        tenantId,
        source,
        scope: g.scope,
        branchId: g.branchId,
        key: g.key,
        value: g.value as any,
        validUntil: g.validUntil ?? null,
      })),
    });
  }

  /** Revoke every grant from one source. */
  async revokeSource(tenantId: string, source: string): Promise<void> {
    await this.prisma.featureEntitlement.deleteMany({ where: { tenantId, source } });
    this.invalidate(tenantId);
  }

  /** Sweep expired rows. Called by a cron in the projector module. */
  async sweepExpired(): Promise<number> {
    const now = new Date();
    const res = await this.prisma.featureEntitlement.deleteMany({
      where: { validUntil: { lt: now } },
    });
    if (res.count > 0) this.logger.log(`Swept ${res.count} expired entitlement rows`);
    // Cache is conservatively cleared — sweep is rare and ttl is short.
    this.cache.clear();
    return res.count;
  }
}
