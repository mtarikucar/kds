import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { fold } from './entitlement-engine';
import {
  EMPTY_ENTITLEMENT_SET,
  EntitlementGrant,
  EntitlementSet,
  EntitlementValue,
} from './entitlement.types';

/**
 * Read & write side of the entitlement engine.
 *
 * Reads are heavy: every authed request may evaluate guards, so the computed
 * set is cached in-process per tenant for 30s. Cache is invalidated on every
 * mutation; a Redis-backed cache replaces this map once we have horizontal
 * replicas (Phase 12). Per-process TTL keeps things correct between replicas
 * even today (worst case: 30s stale, never wrong direction).
 *
 * Writes are append-or-replace upserts keyed by (tenant, branch, key, source)
 * so reprojecting a plan is idempotent and revocation is precise — removing
 * one source never touches another's grants.
 */
@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);
  private readonly cache = new Map<string, { set: EntitlementSet; expiresAt: number }>();
  private readonly cacheTtlMs = 30_000;

  constructor(private readonly prisma: PrismaService) {}

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
    this.cache.set(cacheKey, { set, expiresAt: Date.now() + this.cacheTtlMs });
    return set;
  }

  /** Force a refresh on next read. Called on any mutation. */
  invalidate(tenantId: string): void {
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
    });
    this.invalidate(tenantId);
    this.logger.debug(`Reprojected source=${source} tenant=${tenantId} grants=${grants.length}`);
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
