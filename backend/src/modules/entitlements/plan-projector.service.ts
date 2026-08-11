import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { withAdvisoryLock } from "../../common/scheduling/advisory-lock";
import { EntitlementService } from "./entitlement.service";
import { EntitlementGrant } from "./entitlement.types";
import { ADDON_GRACE_DAYS } from "../marketplace/marketplace.types";
import {
  FREE_BASELINE_GRANTS,
  FREE_BASELINE_SOURCE,
} from "./free-baseline.const";

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

  /** Project one tenant. Call after any subscription/override mutation. */
  async projectTenant(tenantId: string): Promise<void> {
    // Chain onto the existing in-flight projection for this tenant. Each
    // caller awaits the chain head; new callers extend it. Failures
    // propagate naturally because we await before continuing.
    const prior = this.tenantLocks.get(tenantId) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(() => this.projectTenantInner(tenantId));
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

    // ---------------------------------------------------------------------
    // FREE BASELINE (v3.3.0)
    // ---------------------------------------------------------------------
    // The core product is free and unlimited for every tenant, so there is no
    // plan to read, no subscription status to interrogate, and no FREE-plan
    // fallback. What used to be "project the plan's columns, or the FREE
    // plan's columns if the subscription lapsed" is now one constant.
    //
    // The keys the old plan columns carried still exist here — the retired
    // caps are granted as -1. That is not decoration: -1 DOMINATES the engine
    // limit fold, so any stale plan-sourced row that outlives the migration
    // cannot cap a tenant who is supposed to be unlimited.
    const baselineGrants: Array<Omit<EntitlementGrant, "tenantId" | "source">> =
      Object.entries(FREE_BASELINE_GRANTS).map(([key, value]) => ({
        scope: "tenant",
        branchId: null,
        key,
        value,
        validUntil: null,
      }));

    const overrideGrants: Array<Omit<EntitlementGrant, "tenantId" | "source">> =
      [];
    const featureOverrides =
      (tenant.featureOverrides as Record<string, boolean> | null) ?? null;
    const limitOverrides =
      (tenant.limitOverrides as Record<string, number> | null) ?? null;
    if (featureOverrides) {
      for (const [k, raw] of Object.entries(featureOverrides)) {
        // TRI-STATE OVERRIDES (v3.3.0).
        //
        // Pre-3.3 every key here — including `false` — was projected as
        // `{__replace: v}`. Because __replace is applied AFTER the additive
        // OR pass, a `false` override permanently SUPPRESSED a feature the
        // tenant might later legitimately BUY: they paid, the guard still
        // 403'd, and nothing in the UI explained why. Worse, provisioning
        // seeded this map with the plan's TRUE features, so after the flip
        // every existing tenant would have carried `__replace:true` grants
        // and received paid modules free forever. The P3 migration archives
        // and clears the column; this is the shape that replaces it.
        //
        // `grant` projects a PLAIN true, which OR-folds and can never block a
        // later purchase. Only `suppress` uses __replace — the one shape with
        // teeth, now named, and reserved for abuse handling.
        const mode =
          typeof raw === "object" && raw !== null
            ? (raw as { mode?: string }).mode
            : raw === true
              ? "grant"
              : "suppress";
        if (mode === "grant") {
          overrideGrants.push({
            scope: "tenant",
            branchId: null,
            key: `feature.${k}`,
            value: true,
            validUntil: null,
          });
        } else {
          overrideGrants.push({
            scope: "tenant",
            branchId: null,
            key: `feature.${k}`,
            value: { __replace: false } as any,
            validUntil: null,
          });
        }
      }
    }
    if (limitOverrides) {
      for (const [k, v] of Object.entries(limitOverrides)) {
        overrideGrants.push({
          scope: "tenant",
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
      await this.entitlements.setGrantsForSourceTx(
        tx,
        tenantId,
        FREE_BASELINE_SOURCE,
        baselineGrants,
      );

      // Sweep EVERY plan-sourced row. Plans are retired; a survivor would
      // fold into the set as free access nobody is paying for. Inside the txn
      // so no reader ever sees baseline and plan grants at the same time.
      await tx.featureEntitlement.deleteMany({
        where: { tenantId, source: { startsWith: "plan:" } },
      });

      // Overrides → admin source. Overrides REPLACE the plan value via
      // the engine's __replace wrapper. Empty objects emit no grants
      // (which deletes any prior override:admin rows).
      await this.entitlements.setGrantsForSourceTx(
        tx,
        tenantId,
        "override:admin",
        overrideGrants,
      );

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
   *
   * Manual-renewal grace: `past_due` rows still grant. A recurring add-on
   * whose paid period ended without re-payment (no PayTR card vault) is
   * flipped to `past_due` by the sweeper and KEEPS its capability through a
   * 7-day grace window — mirroring Subscription PAST_DUE, which the status
   * guard also treats as live. Only when the sweeper flips it to `expired`
   * at grace end does the row drop out of this query and lose its grant.
   * For a past_due row the grant's `validUntil` is the grace deadline
   * (currentPeriodEnd + 7d) so the entitlement-engine grace sweeper doesn't
   * prematurely drop it on its own clock.
   */
  private async projectAddOnsTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<void> {
    const activeAddOns = await tx.tenantAddOn.findMany({
      where: { tenantId, status: { in: ["active", "past_due"] } },
      include: { addOn: true },
    });

    // LICENCE SUPPRESSION (v3.3.0).
    //
    // Every `requiresLicense` product is unusable without a live licence, so
    // while the licence is dark its grants are withheld — WITHOUT touching a
    // single row of business data. The ownership rows stay `active`, their
    // chargedCents stay, and stock / reservations / personnel / generated AI
    // media all stay exactly where they are. Paying the licence back re-lights
    // everything on the next projection.
    //
    // This is the real enforcement point. The cart-level LICENSE_REQUIRED
    // check stops the sale; this stops the ACCESS, which is what matters when
    // a tenant renews some lines of their anniversary invoice but not the
    // licence itself.
    const now = Date.now();
    const licenceLive = activeAddOns.some(
      (ta) =>
        ta.addOn.kind === "license" &&
        (ta.currentPeriodEnd == null ||
          ta.currentPeriodEnd.getTime() +
            (ta.status === "past_due" ? ADDON_GRACE_DAYS * 86_400_000 : 0) >
            now),
    );

    const desiredSources = new Set<string>();
    for (const ta of activeAddOns) {
      const source = `addon:${ta.addOn.code}:${ta.id}`;
      desiredSources.add(source);

      const grants: Array<Omit<EntitlementGrant, "tenantId" | "source">> = [];
      const catalogGrants = (ta.addOn.grants as Record<string, unknown>) ?? {};

      // The source row is still written (so the tenant's owned-items list
      // stays complete) but with an EMPTY grant array.
      const suppressed = ta.addOn.requiresLicense && !licenceLive;

      // GRACE WINDOW — v3.3.0 fix for an annual blackout.
      //
      // Pre-3.3 an `active` row's validUntil was exactly currentPeriodEnd,
      // while only `past_due` got the +7d grace. But the engine's own
      // validUntil sweep runs every 5 MINUTES and the add-on sweeper that
      // flips active → past_due runs on a daily cron. At every tenant's
      // anniversary those two clocks disagreed for hours: the grant expired
      // at midnight and nothing re-granted it until the sweeper woke up —
      // a yearly, hours-long lockout for every paying customer. Give ACTIVE
      // rows the same grace horizon so the sweeper, not the clock, is what
      // ends access.
      const validUntil = ta.currentPeriodEnd
        ? new Date(
            ta.currentPeriodEnd.getTime() + ADDON_GRACE_DAYS * 24 * 3600 * 1000,
          )
        : null;

      for (const [key, raw] of Object.entries(
        suppressed ? {} : catalogGrants,
      )) {
        if (key.startsWith("feature.")) {
          grants.push({
            scope: ta.branchId ? "branch" : "tenant",
            branchId: ta.branchId,
            key,
            value: Boolean(raw),
            validUntil,
          });
        } else if (key.startsWith("limit.")) {
          const n = typeof raw === "number" ? raw : 0;
          const scaled = n === -1 ? -1 : n * ta.quantity;
          grants.push({
            scope: ta.branchId ? "branch" : "tenant",
            branchId: ta.branchId,
            key,
            value: scaled,
            validUntil,
          });
        } else if (key.startsWith("credit.")) {
          // Credits are a prepaid BALANCE, read live inside the
          // advisory-locked claim. Projecting them would put a 30s-cached
          // number in front of a real vendor charge. Skip — writing the row
          // would only accumulate dead entitlements the engine ignores.
          continue;
        } else if (key.startsWith("integration.")) {
          if (Array.isArray(raw)) {
            grants.push({
              scope: ta.branchId ? "branch" : "tenant",
              branchId: ta.branchId,
              key,
              value: raw.filter((x) => typeof x === "string"),
              validUntil,
            });
          }
        }
      }

      await this.entitlements.setGrantsForSourceTx(
        tx,
        tenantId,
        source,
        grants,
      );
    }

    // Revoke stale add-on sources. Now inside the outer projectTenant
    // txn so the visibility window between "new addon source written"
    // and "stale addon sources cleared" doesn't exist.
    if (desiredSources.size === 0) {
      await tx.featureEntitlement.deleteMany({
        where: { tenantId, source: { startsWith: "addon:" } },
      });
    } else {
      await tx.featureEntitlement.deleteMany({
        where: {
          tenantId,
          source: { startsWith: "addon:", notIn: Array.from(desiredSources) },
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
    this.logger.log(
      `Entitlement backfill: scanned=${tenants.length} projected=${projected}`,
    );
    return { scanned: tenants.length, projected };
  }

  /**
   * Nightly drift-fix: re-project every tenant so any operational mutation
   * that bypassed the projector is reconciled. Cheap (one read + one upsert
   * per tenant) and idempotent. Runs at 03:15 UTC to avoid the report jobs
   * at 03:00.
   */
  @Cron("15 3 * * *")
  async reconcileNightly(): Promise<void> {
    await withAdvisoryLock(
      this.prisma,
      "entitlements.reconcileNightly",
      async () => {
        const tenants = await this.prisma.tenant.findMany({
          select: { id: true },
        });
        for (const t of tenants) {
          try {
            await this.projectTenant(t.id);
          } catch (e) {
            this.logger.warn(
              `projectTenant ${t.id} failed: ${(e as Error).message}`,
            );
          }
        }
        this.logger.log(
          `Nightly entitlement reconcile: ${tenants.length} tenants`,
        );
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
      "entitlements.sweepExpired",
      async () => {
        await this.entitlements.sweepExpired();
      },
      this.logger,
    );
  }
}
