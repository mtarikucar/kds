import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { withAdvisoryLock } from '../../common/scheduling/advisory-lock';
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
  //
  // ⚠ DRIFT TRIPWIRE: This list must include every Boolean feature column
  // on the SubscriptionPlan model in prisma/schema.prisma. Forgetting to
  // add a new column here means the projector silently never surfaces it
  // and tenants on the paying plan don't get the feature. A snapshot
  // test in plan-projector.service.spec.ts (iter-24) pins the expected
  // list and fails when the projector and schema diverge. If you're
  // adding a new flag, update both.
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

  /**
   * Per-tenant in-process mutex for projectTenant. Two parallel events
   * for the same tenant (e.g. addon.purchased + subscription.activated
   * arriving in the same outbox batch) would otherwise race the
   * read-then-write cycle, each missing the other's mutation. The mutex
   * serialises projections per tenant; different tenants still run in
   * parallel. Cross-replica serialisation isn't required because the
   * projection is idempotent — the worst case is the second run sees
   * what the first wrote and is a no-op.
   */
  private readonly tenantLocks = new Map<string, Promise<void>>();

  // v2.8.89: cache the FREE plan row for ~5 minutes so the projector
  // doesn't issue a separate findUnique on every projection. Looked up
  // by name (the seed contract — `SubscriptionPlanType.FREE`). On miss
  // we fall through to plan:NONE which projects no grants — same
  // behavior as a tenant without `currentPlanId` today.
  private freePlanCache: { plan: any; expiresAt: number } | null = null;

  private async resolveFreePlan(): Promise<any | null> {
    const now = Date.now();
    if (this.freePlanCache && this.freePlanCache.expiresAt > now) {
      return this.freePlanCache.plan;
    }
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { name: 'FREE' as any },
    });
    if (plan) {
      this.freePlanCache = { plan, expiresAt: now + 5 * 60_000 };
    }
    return plan;
  }

  /** Project one tenant. Call after any subscription/override mutation. */
  async projectTenant(tenantId: string): Promise<void> {
    // Chain onto the existing in-flight projection for this tenant. Each
    // caller awaits the chain head; new callers extend it. Failures
    // propagate naturally because we await before continuing.
    const prior = this.tenantLocks.get(tenantId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(() => this.projectTenantInner(tenantId));
    this.tenantLocks.set(tenantId, next);
    try {
      await next;
    } finally {
      // Clear the slot only if it's still pointing at us (a later caller
      // may have already overwritten it with their own chain).
      if (this.tenantLocks.get(tenantId) === next) {
        this.tenantLocks.delete(tenantId);
      }
    }
  }

  private async projectTenantInner(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { currentPlan: true },
    });
    if (!tenant) return;

    // v2.8.89: subscription-status-aware projection (the belt half of
    // "belt + suspenders" for the 4 critical lifecycle bugs the v2.8.88
    // audit surfaced). Pre-v2.8.89 the projector read tenant.currentPlan
    // directly and never looked at Subscription.status. Cancel/expire
    // flows that flipped status without also flipping currentPlanId
    // (cancelSubscription immediate, period-end cron, past-due cron,
    // PayTR settlement) caused the projector to KEEP re-writing the
    // paid plan grants every time a SubscriptionCancelled event fired
    // (or worse: never fire at all when currentPlanId mutation went
    // unaccompanied by a lifecycle event, as in PayTR settlement). The
    // EXPIRED tenant therefore retained full paid entitlements until
    // the nightly reconcile cron ran 24h later.
    //
    // The suspenders are explicit currentPlanId flips in the lifecycle
    // services; the belt is here. If the active subscription row is
    // not ACTIVE/TRIALING we project FREE plan grants regardless of
    // what currentPlanId points at. Any lifecycle flow that forgets to
    // update currentPlanId degrades gracefully — the engine surfaces
    // exactly the access the tenant has paid for at that moment.
    const activeSub = await this.prisma.subscription.findFirst({
      where: {
        tenantId,
        status: { in: ['ACTIVE', 'TRIALING'] },
      },
      select: { id: true, status: true },
      orderBy: { updatedAt: 'desc' },
    });
    const isAccessPaid = activeSub != null;
    const effectivePlan = isAccessPaid
      ? tenant.currentPlan
      : await this.resolveFreePlan();

    // v2.8.97 — surface the drift case for ops/audit. When the active
    // subscription's plan doesn't match the tenant's currentPlanId
    // pointer we want to know — it's a lifecycle bug somewhere, and
    // even though the engine fold below uses the right grants, the
    // tenant's billing UI / receipts read currentPlanId directly and
    // will mislead the operator. The reconcile cron eventually heals
    // this but the log lets us pre-empt the discovery.
    if (
      effectivePlan &&
      tenant.currentPlanId &&
      effectivePlan.id !== tenant.currentPlanId
    ) {
      this.logger.warn(
        `Plan pointer drift detected for tenant=${tenantId}: ` +
          `Tenant.currentPlanId=${tenant.currentPlanId} vs effectivePlan.id=${effectivePlan.id} (${effectivePlan.name}). ` +
          `Engine projection uses effectivePlan; lifecycle flow likely missed a currentPlanId update.`,
      );
    }

    const planSource = effectivePlan ? `plan:${effectivePlan.name}` : 'plan:NONE';
    const planGrants: Array<Omit<EntitlementGrant, 'tenantId' | 'source'>> = [];

    if (effectivePlan) {
      for (const col of PlanProjectorService.FEATURE_COLUMNS) {
        if ((effectivePlan as any)[col]) {
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
        const v = (effectivePlan as any)[col];
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

    // Iter-76: every write in one $transaction so no concurrent reader
    // sees a half-projected state. The pre-fix shape did separate calls:
    //
    //   setGrantsForSource(planSource, ...)       // commits, txn 1
    //   deleteMany(stale plan:* sources)          // commits, txn 2
    //   setGrantsForSource('override:admin', ...) // commits, txn 3
    //   projectAddOns(...)                        // N more txns
    //
    // Between txn 1 and txn 2 on a plan switch (BASIC → PRO), readers
    // saw BOTH the old plan's `plan:BASIC` rows AND the new plan's
    // `plan:PRO` rows. The engine's `limit.*` rule is SUM, so a tenant
    // briefly got BASIC.maxUsers=5 + PRO.maxUsers=20 = 25 — short
    // window, but the post-invalidate cache miss happens at exactly
    // the wrong time (the projector calls invalidate after txn 1 but
    // txn 2 hasn't fired yet) so it's a more reliable race than it
    // looks. Same shape for projectAddOns' stale-source sweep.
    //
    // One outer txn collapses the visibility window to zero. The
    // entitlement cache is invalidated ONCE at the end so peer
    // replicas refresh atomically too.
    await this.prisma.$transaction(async (tx) => {
      await this.entitlements.setGrantsForSourceTx(tx, tenantId, planSource, planGrants);

      // Clear stale plan:* sources from prior plans (downgrade, switch).
      // Now inside the txn so the window where both plans' grants are
      // visible doesn't exist for any external reader.
      await tx.featureEntitlement.deleteMany({
        where: {
          tenantId,
          source: { startsWith: 'plan:', not: planSource },
        },
      });

      // Overrides → admin source. Overrides REPLACE the plan value via
      // the engine's __replace wrapper. Empty objects emit no grants
      // (which deletes any prior override:admin rows).
      await this.entitlements.setGrantsForSourceTx(tx, tenantId, 'override:admin', overrideGrants);

      await this.projectAddOnsTx(tx, tenantId);
    });

    // Single invalidate at the end so the next read picks up the
    // fully-projected state. Bus fan-out goes to peer replicas too.
    this.entitlements.invalidate(tenantId);
  }

  /**
   * Project this tenant's active add-ons into entitlement grants.
   *
   * Transactional variant — iter-76 inlined into the outer projectTenant
   * txn so add-on writes share the visibility window with plan writes
   * and override writes. Caller owns cache invalidation.
   *
   * Each TenantAddOn row produces one source `addon:<code>:<id>` whose grants
   * are derived from the catalog row's `grants` JSON, with numeric values
   * multiplied by `quantity` (capacity add-ons buy in bulk). Stale sources
   * (add-ons that were cancelled or expired since the last projection) are
   * detected by diffing the current source list and revoked atomically.
   */
  private async projectAddOnsTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<void> {
    const activeAddOns = await tx.tenantAddOn.findMany({
      where: { tenantId, status: 'active' },
      include: { addOn: true },
    });

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

      await this.entitlements.setGrantsForSourceTx(tx, tenantId, source, grants);
    }

    // Revoke stale add-on sources. Now inside the outer projectTenant
    // txn so the visibility window between "new addon source written"
    // and "stale addon sources cleared" doesn't exist.
    if (desiredSources.size === 0) {
      await tx.featureEntitlement.deleteMany({
        where: { tenantId, source: { startsWith: 'addon:' } },
      });
    } else {
      await tx.featureEntitlement.deleteMany({
        where: {
          tenantId,
          source: { startsWith: 'addon:', notIn: Array.from(desiredSources) },
        },
      });
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
    await withAdvisoryLock(
      this.prisma,
      'entitlements.reconcileNightly',
      async () => {
        const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
        for (const t of tenants) {
          try {
            await this.projectTenant(t.id);
          } catch (e) {
            this.logger.warn(`projectTenant ${t.id} failed: ${(e as Error).message}`);
          }
        }
        this.logger.log(`Nightly entitlement reconcile: ${tenants.length} tenants`);
      },
      this.logger,
    );
  }

  /**
   * Sweeper for expired grace grants. Runs every 5 minutes — cheap because
   * the partial index on validUntil makes the scan effectively free until
   * something actually expires. Advisory lock prevents duplicate sweeps
   * (which would each invalidate the in-process cache on every replica).
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepExpired(): Promise<void> {
    await withAdvisoryLock(
      this.prisma,
      'entitlements.sweepExpired',
      async () => {
        await this.entitlements.sweepExpired();
      },
      this.logger,
    );
  }
}
