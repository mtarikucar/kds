import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from './entitlement.service';
import { EntitlementGrant } from './entitlement.types';

/**
 * Projects the legacy SubscriptionPlan + Tenant.featureOverrides /
 * limitOverrides shape into FeatureEntitlement rows.
 *
 * This is the migration bridge: the rest of the codebase keeps writing
 * subscription/override state the way it does today, and this service
 * keeps the entitlement table in sync so the new engine has data to
 * serve. Once every consumer reads from the engine, the legacy guards
 * (PlanFeatureGuard, SubscriptionGuard) become thin wrappers that just
 * forward to EntitlementService — but we do not flip that switch yet.
 *
 * Sources used:
 *   plan:<PLAN_NAME>      — flags + numeric limits from the current plan row
 *   override:admin        — admin-set deltas from Tenant.featureOverrides /
 *                           limitOverrides (REPLACE semantics)
 *
 * Re-projection is idempotent: setGrantsForSource deletes any prior rows
 * tagged with that source before inserting, so re-running this service
 * after a plan change just refreshes existing rows.
 */
@Injectable()
export class PlanProjectorService {
  private readonly logger = new Logger(PlanProjectorService.name);

  // Map SubscriptionPlan column names → entitlement keys. These mirror the
  // PlanFeature enum but live here so the engine never imports legacy types.
  private static readonly FEATURE_COLUMNS = [
    'advancedReports',
    'multiLocation',
    'customBranding',
    'apiAccess',
    'prioritySupport',
    'inventoryTracking',
    'kdsIntegration',
    'reservationSystem',
    'personnelManagement',
    'deliveryIntegration',
  ] as const;

  private static readonly LIMIT_COLUMNS = [
    'maxUsers',
    'maxTables',
    'maxProducts',
    'maxCategories',
    'maxMonthlyOrders',
  ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
  ) {}

  /** Project one tenant. Call after any subscription/override mutation. */
  async projectTenant(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { currentPlan: true },
    });
    if (!tenant) return;

    const planSource = tenant.currentPlan ? `plan:${tenant.currentPlan.name}` : 'plan:NONE';
    const planGrants: Array<Omit<EntitlementGrant, 'tenantId' | 'source'>> = [];

    if (tenant.currentPlan) {
      for (const col of PlanProjectorService.FEATURE_COLUMNS) {
        // Surface only enabled features. Disabled features stay absent from
        // the grant table — the engine treats absence as "not enabled".
        if ((tenant.currentPlan as any)[col]) {
          planGrants.push({
            scope: 'tenant',
            branchId: null,
            key: `feature.${col}`,
            value: true,
            validUntil: null,
          });
        }
      }
      for (const col of PlanProjectorService.LIMIT_COLUMNS) {
        const v = (tenant.currentPlan as any)[col];
        if (typeof v === 'number') {
          planGrants.push({
            scope: 'tenant',
            branchId: null,
            key: `limit.${col}`,
            value: v,
            validUntil: null,
          });
        }
      }
    }

    await this.entitlements.setGrantsForSource(tenantId, planSource, planGrants);

    // Clear any stale plan:* sources from prior plans (downgrade, switch).
    const stale = await this.prisma.featureEntitlement.findMany({
      where: {
        tenantId,
        source: { startsWith: 'plan:', not: planSource },
      },
      distinct: ['source'],
      select: { source: true },
    });
    for (const s of stale) {
      await this.entitlements.revokeSource(tenantId, s.source);
    }

    // Overrides → admin source. Overrides REPLACE the plan value, so they
    // use the engine's __replace wrapper. Empty objects emit no grants.
    const overrideGrants: Array<Omit<EntitlementGrant, 'tenantId' | 'source'>> = [];
    const featureOverrides = (tenant.featureOverrides as Record<string, boolean> | null) ?? null;
    const limitOverrides = (tenant.limitOverrides as Record<string, number> | null) ?? null;
    if (featureOverrides) {
      for (const [k, v] of Object.entries(featureOverrides)) {
        overrideGrants.push({
          scope: 'tenant',
          branchId: null,
          key: `feature.${k}`,
          value: { __replace: Boolean(v) } as any,
          validUntil: null,
        });
      }
    }
    if (limitOverrides) {
      for (const [k, v] of Object.entries(limitOverrides)) {
        overrideGrants.push({
          scope: 'tenant',
          branchId: null,
          key: `limit.${k}`,
          value: { __replace: Number(v) } as any,
          validUntil: null,
        });
      }
    }
    await this.entitlements.setGrantsForSource(tenantId, 'override:admin', overrideGrants);

    await this.projectAddOns(tenantId);
  }

  /**
   * Project this tenant's active add-ons into entitlement grants.
   *
   * Each TenantAddOn row produces one source `addon:<code>:<id>` whose grants
   * are derived from the catalog row's `grants` JSON, with numeric values
   * multiplied by `quantity` (capacity add-ons buy in bulk). Stale sources
   * (add-ons that were cancelled or expired since the last projection) are
   * detected by diffing the current source list and revoked individually.
   */
  private async projectAddOns(tenantId: string): Promise<void> {
    const activeAddOns = await this.prisma.tenantAddOn.findMany({
      where: { tenantId, status: 'active' },
      include: { addOn: true },
    });

    // Build the set of sources we expect after this projection runs. Anything
    // currently tagged `addon:*` but missing from this set was cancelled or
    // expired and gets revoked.
    const desiredSources = new Set<string>();
    for (const ta of activeAddOns) {
      const source = `addon:${ta.addOn.code}:${ta.id}`;
      desiredSources.add(source);

      const grants: Array<Omit<EntitlementGrant, 'tenantId' | 'source'>> = [];
      const catalogGrants = (ta.addOn.grants as Record<string, unknown>) ?? {};
      const validUntil = ta.currentPeriodEnd ?? null;

      for (const [key, raw] of Object.entries(catalogGrants)) {
        if (key.startsWith('feature.')) {
          grants.push({
            scope: ta.branchId ? 'branch' : 'tenant',
            branchId: ta.branchId,
            key,
            value: Boolean(raw),
            validUntil,
          });
        } else if (key.startsWith('limit.')) {
          // Numeric grants scale with quantity, EXCEPT for the unlimited
          // sentinel -1 which always means unlimited regardless of count.
          const n = typeof raw === 'number' ? raw : 0;
          const scaled = n === -1 ? -1 : n * ta.quantity;
          grants.push({
            scope: ta.branchId ? 'branch' : 'tenant',
            branchId: ta.branchId,
            key,
            value: scaled,
            validUntil,
          });
        } else if (key.startsWith('integration.')) {
          if (Array.isArray(raw)) {
            grants.push({
              scope: ta.branchId ? 'branch' : 'tenant',
              branchId: ta.branchId,
              key,
              value: raw.filter((x) => typeof x === 'string'),
              validUntil,
            });
          }
        }
      }

      await this.entitlements.setGrantsForSource(tenantId, source, grants);
    }

    // Revoke stale add-on sources. The projector is the only writer of
    // `addon:*` sources, so any extra row here is by definition orphaned.
    const existing = await this.prisma.featureEntitlement.findMany({
      where: { tenantId, source: { startsWith: 'addon:' } },
      distinct: ['source'],
      select: { source: true },
    });
    for (const e of existing) {
      if (!desiredSources.has(e.source)) {
        await this.entitlements.revokeSource(tenantId, e.source);
      }
    }
  }

  /**
   * Backfill on boot for any tenant missing entitlement rows.
   *
   * Idempotent: skip tenants that already have *any* row. The detailed
   * `projectTenant` is what brings rows up to date on mutation; this is
   * just the initial sync after deploying the entitlement engine.
   */
  async backfillMissing(): Promise<{ scanned: number; projected: number }> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    let projected = 0;
    for (const t of tenants) {
      const has = await this.prisma.featureEntitlement.count({
        where: { tenantId: t.id },
      });
      if (has > 0) continue;
      await this.projectTenant(t.id);
      projected++;
    }
    this.logger.log(`Entitlement backfill: scanned=${tenants.length} projected=${projected}`);
    return { scanned: tenants.length, projected };
  }

  /**
   * Nightly drift-fix: re-project every tenant so any operational mutation
   * that bypassed the projector is reconciled. Cheap (one read + one upsert
   * per tenant) and idempotent. Runs at 03:15 UTC to avoid the report jobs
   * at 03:00.
   */
  @Cron('15 3 * * *')
  async reconcileNightly(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    for (const t of tenants) {
      try {
        await this.projectTenant(t.id);
      } catch (e) {
        this.logger.warn(`projectTenant ${t.id} failed: ${(e as Error).message}`);
      }
    }
    this.logger.log(`Nightly entitlement reconcile: ${tenants.length} tenants`);
  }

  /**
   * Sweeper for expired grace grants. Runs every 5 minutes — cheap because
   * the partial index on validUntil makes the scan effectively free until
   * something actually expires.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepExpired(): Promise<void> {
    await this.entitlements.sweepExpired();
  }
}
