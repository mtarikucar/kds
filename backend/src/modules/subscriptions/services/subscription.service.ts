import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { addDays, addMonths, addYears } from "date-fns";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  resolvePlanAmount,
  isPlanDiscountActive,
} from "../plan-pricing.helper";
import { BillingService } from "./billing.service";
import { NotificationService } from "./notification.service";
import { OutboxService } from "../../outbox/outbox.service";
import { EventTypes } from "../../outbox/event-types";
import { EntitlementService } from "../../entitlements/entitlement.service";
import {
  SubscriptionStatus,
  BillingCycle,
  PaymentProvider,
  SubscriptionPlanType,
} from "../../../common/constants/subscription.enum";
import { CreateSubscriptionDto } from "../dto/create-subscription.dto";
import { ChangePlanDto } from "../dto/change-plan.dto";
import { UpdateSubscriptionDto } from "../dto/update-subscription.dto";
import { foldPlanGrants } from "./effective-features.fold";
import { MetricsService } from "../../../common/metrics/metrics.service";
import { DowngradeUsageGuardService } from "./downgrade-usage-guard.service";
import { DemoGuardService } from "../../demo/demo-guard.service";

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private prisma: PrismaService,
    private billingService: BillingService,
    private notificationService: NotificationService,
    // OutboxModule is @Global, so injection works without a module-level
    // import. Wired so meaningful subscription transitions emit events
    // for the entitlement projector and any later consumers (audit,
    // marketing automation, support tickets) to react to.
    private readonly outbox: OutboxService,
    // v2.8.88: getEffectiveFeatures now routes through the engine's
    // resolved view so add-on grants (TenantAddOn → projector → engine)
    // reach the frontend. Pre-v2.8.88 this endpoint read plan rows +
    // overrides only — buying integration_yemeksepeti updated the engine
    // table but the UI never saw the change (it pulls from this method).
    private readonly entitlements: EntitlementService,
    // Optional so unit tests constructing the service bare keep working and
    // so a context without MetricsModule never fails to resolve.
    @Optional() private readonly metrics?: MetricsService,
    // Downgrade usage-limit guard extracted from this service. @Optional()
    // so the bare unit-test constructors (which predate it) keep resolving;
    // when DI omits it, `downgradeGuard` below lazily builds one over the
    // same PrismaService so the extracted query runs identically.
    @Optional()
    private readonly injectedDowngradeGuard?: DowngradeUsageGuardService,
    // Demo-tenant real-money block. @Optional so unit tests constructing the
    // service bare keep working — SubscriptionsModule imports DemoGuardModule
    // so production DI always supplies a real instance; the changePlan call
    // site is `?.`-guarded so a bare-constructed test that never wires this
    // in doesn't perform a real Prisma call it didn't ask for.
    @Optional() private readonly demoGuard?: DemoGuardService,
  ) {}

  /**
   * Resolve the downgrade usage-limit guard. Prefers the DI-provided
   * collaborator; falls back to a Prisma-backed instance so unit tests that
   * construct SubscriptionService without the guard still exercise the real
   * (extracted-verbatim) check rather than a stub.
   */
  private get downgradeGuard(): DowngradeUsageGuardService {
    if (!this.injectedDowngradeGuard) {
      this.lazyDowngradeGuard ??= new DowngradeUsageGuardService(this.prisma);
      return this.lazyDowngradeGuard;
    }
    return this.injectedDowngradeGuard;
  }
  private lazyDowngradeGuard?: DowngradeUsageGuardService;

  /**
   * Track 2 — record a committed subscription billing transition for
   * Prometheus. Always called AFTER the mutating $transaction commits, and
   * ?.-guarded so a missing collaborator can never break the business write.
   * `event` is the developer-controlled lifecycle enum (create|change|
   * cancel|reactivate), so label cardinality stays bounded.
   */
  private recordBillingEvent(
    event: "create" | "change" | "cancel" | "reactivate",
  ): void {
    this.metrics?.incCounter(
      "subscription_billing_total",
      "Subscription billing lifecycle transitions (create|change|cancel|reactivate)",
      { event },
    );
  }

  /**
   * Auditability — record a privileged billing decision (who created /
   * changed / cancelled a paying subscription) in user_activities, the
   * codebase's tenant-scoped audit log. The outbox lifecycle events the
   * projector consumes are actor-less, so this is the only place the
   * acting admin is captured for a "who changed our plan / cancelled our
   * billing" forensic question.
   *
   * Best-effort and post-commit: a failure to write the audit row must
   * never roll back or block the billing mutation that already succeeded,
   * mirroring the emitLifecycle / notify swallow-and-log pattern. Skipped
   * when there is no human actor (scheduler / cron callers pass none).
   */
  private async writeBillingAudit(
    tenantId: string,
    actorUserId: string | undefined,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!actorUserId) return;
    try {
      await this.prisma.userActivity.create({
        data: {
          userId: actorUserId,
          tenantId,
          action,
          metadata: metadata as any,
        },
      });
    } catch (e) {
      this.logger.warn(
        `billing audit ${action} failed for tenant=${tenantId}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Append a subscription lifecycle event to the outbox.
   *
   * Centralised so every mutation site uses the same payload shape; the
   * outbox worker delivers to the in-process bus and the entitlement
   * projector reprojects. Failures here are swallowed — the user-facing
   * action has already succeeded, and the nightly reconcile would catch
   * any miss anyway. Logged for observability.
   */
  private async emitLifecycle(
    type: string,
    sub: {
      id: string;
      tenantId: string;
      plan?: { name?: string } | null;
      currentPeriodStart?: Date | null;
      currentPeriodEnd?: Date | null;
    },
    tx?: any,
  ): Promise<void> {
    try {
      // v2.8.94 — accept an optional tx so the lifecycle event lands in
      // the same Postgres transaction as the (subscription, tenant)
      // mutation. Pre-fix the emit happened *after* the txn committed,
      // so a process crash between commit and emit left the subscription
      // in its new state with no SubscriptionCancelled / -Downgraded /
      // -Activated event for the projector to react to — entitlements
      // diverged for up to 24h (until the reconcile cron). Passing tx
      // makes the invariant: business state ⇔ outbox row.
      await this.outbox.append(
        {
          type,
          tenantId: sub.tenantId,
          payload: {
            subscriptionId: sub.id,
            tenantId: sub.tenantId,
            planCode: sub.plan?.name,
            periodStart: sub.currentPeriodStart?.toISOString(),
            periodEnd: sub.currentPeriodEnd?.toISOString(),
          },
        },
        tx,
      );
    } catch (e) {
      this.logger.warn(
        `outbox emit ${type} failed for sub=${sub.id}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Public reproject trigger for out-of-band plan mutations (e.g. a
   * superadmin force-changing a tenant's plan). Emits the same
   * SubscriptionActivated lifecycle event the normal activation paths use,
   * so the entitlement projector reprojects `feature.*`/`limit.*` grants and
   * the engine cache invalidates. Without this a superadmin plan change left
   * the tenant on its OLD feature set until the nightly reconcile. Pass the
   * caller's `tx` so the event lands in the same transaction as the
   * (subscription, tenant.currentPlanId) mutation.
   */
  async emitSubscriptionReprojection(
    sub: {
      id: string;
      tenantId: string;
      plan?: { name?: string } | null;
      currentPeriodStart?: Date | null;
      currentPeriodEnd?: Date | null;
    },
    tx?: any,
  ): Promise<void> {
    await this.emitLifecycle(EventTypes.SubscriptionActivated, sub, tx);
  }

  /**
   * Best-effort trial-started email. Always called post-commit so a
   * mail-server hiccup never blocks the subscription create. Looks up
   * the tenant's ADMIN to find a recipient — if none exists, we silently
   * skip (the customer can still see TRIALING in-app).
   */
  private async notifyTrialStarted(
    tenantId: string,
    planDisplayName: string,
    trialDays: number,
  ): Promise<void> {
    try {
      const admin = await this.prisma.user.findFirst({
        where: { tenantId, role: "ADMIN" },
        select: { email: true, tenant: { select: { name: true } } },
      });
      if (!admin?.email || !admin.tenant) return;
      await this.notificationService.sendTrialStarted(
        admin.email,
        admin.tenant.name,
        planDisplayName,
        trialDays,
      );
    } catch (err: any) {
      this.logger.error(
        `trial-started notification failed for tenant=${tenantId}: ${err?.message}`,
      );
    }
  }

  /**
   * Latest subscription row for a tenant, regardless of status. Callers
   * decide how to present PAST_DUE / EXPIRED / CANCELLED states; returning
   * `null` only for tenants that have never subscribed avoids the
   * dead-end "no subscription → try to create → already has one" UX.
   */
  async getCurrentSubscription(tenantId: string) {
    // Exclude PENDING — those are unconfirmed PayTR intents that haven't
    // been activated yet. Surfacing them would mislead the UI into
    // showing "you have a subscription" for a tenant whose webhook
    // never arrived. The orphan sweeper rolls them to EXPIRED after
    // 24h; until then the user should still see their last real
    // subscription (or none).
    return this.prisma.subscription.findFirst({
      where: {
        tenantId,
        status: { not: SubscriptionStatus.PENDING },
      },
      include: {
        plan: true,
        payments: { orderBy: { createdAt: "desc" }, take: 5 },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Fetch a subscription, asserting it belongs to the expected tenant.
   * Every controller path that accepts a subscription id must pass the
   * caller's tenantId so cross-tenant IDOR is impossible.
   */
  async getSubscriptionById(id: string, tenantId?: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        plan: true,
        tenant: true,
        payments: { orderBy: { createdAt: "desc" } },
        invoices: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });

    if (!subscription) {
      throw new NotFoundException("Subscription not found");
    }
    if (tenantId && subscription.tenantId !== tenantId) {
      throw new NotFoundException("Subscription not found");
    }
    return subscription;
  }

  async createSubscription(
    tenantId: string,
    dto: CreateSubscriptionDto,
    actorUserId?: string,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException("Tenant not found");

    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId, role: "ADMIN" },
    });
    if (!adminUser) {
      throw new NotFoundException("Admin user not found for this tenant");
    }
    if (!adminUser.emailVerified) {
      throw new BadRequestException(
        "Email must be verified before creating a subscription. " +
          "Please check your email for the 6-digit verification code.",
      );
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan || !plan.isActive) {
      throw new NotFoundException("Plan not found or inactive");
    }
    if (
      !Object.values(BillingCycle).includes(dto.billingCycle as BillingCycle)
    ) {
      throw new BadRequestException("Invalid billing cycle");
    }

    // v3.0.1 round-5 audit fix — trial eligibility is now PER-PLAN, the
    // same shape `getEffectiveFeatures` returns to the SPA. Pre-fix
    // `tenant.trialUsed` was a lifetime gate, so once any plan had been
    // trialed (including the auto-started BUSINESS trial at registration)
    // every subsequent trial was denied — but the SPA showed "14 gün
    // ücretsiz dene" CTAs on every plan the tenant hadn't yet tried, so
    // users clicked through trial flows the backend silently refused.
    // The schema's `usedTrialPlanIds[]` is the canonical per-plan
    // registry (its model-side comment notes the legacy `trialUsed`
    // bool is "Kept for backward-compat"); we now match.
    const usedTrialPlanIds = (tenant.usedTrialPlanIds ?? []) as string[];
    const hasUsedThisPlanTrial = usedTrialPlanIds.includes(plan.id);
    const canUseTrial =
      !hasUsedThisPlanTrial &&
      plan.trialDays > 0 &&
      plan.name !== SubscriptionPlanType.FREE;
    const isTrialPeriod = canUseTrial;

    // SECURITY (deep-review H3): this is the public ADMIN-facing creation
    // entry point (POST /subscriptions). It must never mint a PAID,
    // immediately-ACTIVE subscription — that is grant-before-pay. A paid
    // plan only becomes ACTIVE after PayTR/havale settlement transitions an
    // existing subscription (paytr-settlement / bank-transfer). The only
    // states this path may create are a TRIALING trial or a FREE (amount 0)
    // subscription. Without this gate a tenant whose per-plan trial slot is
    // used and whose live subscription was cancelled/expired could POST a
    // paid planId and self-activate paid access for free (the partial unique
    // index only blocks while a live ACTIVE/TRIALING row already exists).
    if (!isTrialPeriod && plan.name !== SubscriptionPlanType.FREE) {
      throw new BadRequestException(
        "Paid plans must be activated through checkout/payment. " +
          "Start a trial or use the upgrade flow to pay for this plan.",
      );
    }

    // Use date-fns so DST transitions don't skew the period end by an hour.
    const now = new Date();
    const trialStart = isTrialPeriod ? now : null;
    const trialEnd = isTrialPeriod ? addDays(now, plan.trialDays) : null;
    const currentPeriodStart = now;
    const currentPeriodEnd = isTrialPeriod
      ? (trialEnd as Date)
      : dto.billingCycle === BillingCycle.MONTHLY
        ? addMonths(now, 1)
        : addYears(now, 1);

    // Honor any active promotional discount — the price the buyer was shown.
    const amount = resolvePlanAmount(plan, dto.billingCycle);

    // Transaction: subscription + tenant + (optional) pricing snapshot.
    // The DB has a partial unique index on (tenantId) where status IN
    // (ACTIVE, TRIALING), so any concurrent create throws P2002 and the
    // loser's changes are rolled back.
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.create({
          data: {
            tenantId,
            planId: dto.planId,
            status: isTrialPeriod
              ? SubscriptionStatus.TRIALING
              : SubscriptionStatus.ACTIVE,
            billingCycle: dto.billingCycle,
            paymentProvider: PaymentProvider.PAYTR,
            startDate: now,
            currentPeriodStart,
            currentPeriodEnd,
            isTrialPeriod,
            trialStart,
            trialEnd,
            amount,
            currency: plan.currency,
            cancelAtPeriodEnd: false,
          },
          include: { plan: true },
        });

        await tx.tenant.update({
          where: { id: tenantId },
          data: {
            currentPlanId: plan.id,
            trialUsed: isTrialPeriod ? true : tenant.trialUsed,
            trialStartedAt: isTrialPeriod ? trialStart : tenant.trialStartedAt,
            trialEndsAt: isTrialPeriod ? trialEnd : tenant.trialEndsAt,
            // Stamp per-plan trial registry whenever we actually start a trial.
            ...(isTrialPeriod ? { usedTrialPlanIds: { push: plan.id } } : {}),
          },
        });

        return subscription;
      });

      // Fire-and-forget welcome email (only when we actually started a trial).
      if (isTrialPeriod) {
        void this.notifyTrialStarted(
          tenantId,
          plan.displayName,
          plan.trialDays,
        );
      }

      this.recordBillingEvent("create");
      await this.writeBillingAudit(
        tenantId,
        actorUserId,
        "SUBSCRIPTION_CREATED",
        {
          subscriptionId: result.id,
          planId: plan.id,
          planName: plan.name,
          billingCycle: dto.billingCycle,
          amount: amount.toString(),
          currency: plan.currency,
          isTrialPeriod,
        },
      );
      return result;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new BadRequestException(
          "Tenant already has an active subscription",
        );
      }
      throw err;
    }
  }

  /**
   * Start a card-free trial of a paid plan, atomically replacing any
   * existing FREE subscription. Used by PaymentsService.createIntent —
   * the standard registration flow gives every tenant a permanent FREE
   * subscription, so the normal `createSubscription` path would hit the
   * partial-unique index on (tenantId) WHERE status IN (ACTIVE, TRIALING).
   *
   * Contract:
   *   - Eligible only when the tenant currently has no live subscription
   *     OR the live one is on the FREE plan.
   *   - Trial-eligibility (`trialUsed=false`, `plan.trialDays > 0`,
   *     `plan !== FREE`) is the caller's responsibility — by the time we
   *     get here, PaymentsService has already gated.
   *   - Calling-user email-verified check happens here (closing the
   *     dual-user inconsistency that the ADMIN-only check in
   *     createSubscription used to introduce).
   *   - Single transaction: CANCEL old FREE sub, create new TRIALING sub,
   *     stamp `trialUsed`/`trialStartedAt`/`trialEndsAt` on the tenant.
   */
  async startTrialFromIntent(params: {
    tenantId: string;
    callingUserId: string;
    planId: string;
    billingCycle: BillingCycle;
  }) {
    const { tenantId, callingUserId, planId, billingCycle } = params;

    const callingUser = await this.prisma.user.findUnique({
      where: { id: callingUserId },
      select: { emailVerified: true },
    });
    if (!callingUser) {
      throw new NotFoundException("Calling user not found");
    }
    if (!callingUser.emailVerified) {
      throw new BadRequestException(
        "Email must be verified before starting a trial. Please check your inbox for the verification code.",
      );
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
    });
    if (!plan || !plan.isActive) {
      throw new NotFoundException("Plan not found or inactive");
    }
    // Defence-in-depth: PaymentsService is the only known caller and it
    // already gates trialDays/plan-name/usedTrialPlanIds, but a future
    // caller (or a bug) could land us here on an ineligible plan. Reject
    // explicitly instead of silently creating a zero-day "trial" that
    // would burn the tenant's per-plan trial slot.
    if (plan.name === SubscriptionPlanType.FREE) {
      throw new BadRequestException("Cannot start trial on FREE plan");
    }
    if (plan.trialDays <= 0) {
      throw new BadRequestException("Plan does not offer a trial");
    }

    // v3.0.1 round-5 — per-plan eligibility (same shape `getEffectiveFeatures`
    // exposes). Pre-fix was lifetime-per-tenant; see the matching comment
    // in createSubscription for the UX-vs-backend mismatch this resolves.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { usedTrialPlanIds: true },
    });
    if (!tenant) {
      throw new NotFoundException("Tenant not found");
    }
    const usedTrialPlanIds = (tenant.usedTrialPlanIds ?? []) as string[];
    if (usedTrialPlanIds.includes(plan.id)) {
      throw new BadRequestException(
        "Tenant has already used the trial for this plan. Trials are once per plan.",
      );
    }

    const now = new Date();
    const trialEnd = addDays(now, plan.trialDays);
    const amount = resolvePlanAmount(plan, billingCycle);

    try {
      const subscription = await this.prisma.$transaction(async (tx) => {
        // Find the live subscription, if any. Only FREE is allowed to
        // exist here — anything paid means the trial path shouldn't have
        // been reached, so we treat it as a programming error.
        const live = await tx.subscription.findFirst({
          where: {
            tenantId,
            status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
          },
          include: { plan: true },
        });

        if (live && live.plan.name !== SubscriptionPlanType.FREE) {
          throw new BadRequestException(
            "Cannot start trial: tenant already has a paid subscription",
          );
        }

        // Cancel the existing FREE sub (audit trail preserved) so the
        // partial-unique (tenantId) WHERE status IN (ACTIVE, TRIALING)
        // doesn't collide with the new TRIALING row.
        if (live) {
          await tx.subscription.update({
            where: { id: live.id },
            data: {
              status: SubscriptionStatus.CANCELLED,
              endedAt: now,
              cancellationReason: "Replaced by paid-plan trial",
            },
          });
        }

        const subscription = await tx.subscription.create({
          data: {
            tenantId,
            planId: plan.id,
            status: SubscriptionStatus.TRIALING,
            billingCycle,
            paymentProvider: PaymentProvider.PAYTR,
            startDate: now,
            currentPeriodStart: now,
            currentPeriodEnd: trialEnd,
            isTrialPeriod: true,
            trialStart: now,
            trialEnd,
            amount,
            currency: plan.currency,
            cancelAtPeriodEnd: false,
          },
          include: { plan: true },
        });

        // Append this plan to the per-plan trial registry. `trialUsed`
        // stays true for legacy reporting; `usedTrialPlanIds` is the
        // canonical source for future eligibility checks (per-plan model).
        await tx.tenant.update({
          where: { id: tenantId },
          data: {
            currentPlanId: plan.id,
            trialUsed: true,
            trialStartedAt: now,
            trialEndsAt: trialEnd,
            usedTrialPlanIds: { push: plan.id },
          },
        });

        return subscription;
      });

      // Fire-and-forget welcome email. Failures are logged but don't
      // unwind the trial creation.
      void this.notifyTrialStarted(tenantId, plan.displayName, plan.trialDays);

      // TRIALING grants the same access as ACTIVE (see PlanFeatureGuard),
      // so the entitlement projector treats activation and trial start
      // identically. Emit a single canonical "activated" event.
      await this.emitLifecycle(EventTypes.SubscriptionActivated, subscription);

      this.recordBillingEvent("create");
      return subscription;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new BadRequestException(
          "Tenant already has an active subscription",
        );
      }
      throw err;
    }
  }

  /**
   * Compute the impact of a plan change without mutating state.
   * Returns either a downgrade scheduled for period end, or the
   * proration numbers the admin needs to collect off-platform before
   * an upgrade can be applied via `applyUpgrade`.
   *
   * Only valid on subscriptions with a live billing period — PAST_DUE
   * and EXPIRED produce negative proration (currentPeriodEnd already
   * passed), and CANCELLED has no meaningful current plan to switch
   * from. UI routes those statuses to a fresh checkout instead.
   */
  async changePlan(
    subscriptionId: string,
    tenantId: string,
    dto: ChangePlanDto,
    actorUserId?: string,
  ) {
    // Demo-tenant real-money block — very first statement, before
    // isUpgrade/requiresPayment is even computed, so the frontend never
    // navigates to checkout for the shared "explore demo" tenant.
    await this.demoGuard?.assertNotDemo(tenantId);

    const subscription = await this.getSubscriptionById(
      subscriptionId,
      tenantId,
    );

    if (
      subscription.status !== SubscriptionStatus.ACTIVE &&
      subscription.status !== SubscriptionStatus.TRIALING
    ) {
      throw new BadRequestException(
        "Plan change is only available on active or trialing subscriptions. " +
          "Please start a new subscription instead.",
      );
    }

    const currentPlan = subscription.plan;
    const newPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.newPlanId },
    });
    if (!newPlan || !newPlan.isActive) {
      throw new NotFoundException("New plan not found or inactive");
    }
    if (subscription.planId === dto.newPlanId) {
      throw new BadRequestException("Already subscribed to this plan");
    }
    if (subscription.scheduledDowngradePlanId) {
      throw new BadRequestException(
        "There is already a scheduled plan change. Please cancel it first.",
      );
    }
    // Cross-currency plan changes don't have meaningful proration math;
    // refuse them instead of silently producing a garbage diff.
    if (currentPlan.currency !== newPlan.currency) {
      throw new BadRequestException(
        "Plan currency change is not supported. Contact support to switch currencies.",
      );
    }

    const billingCycle = (dto.billingCycle ||
      subscription.billingCycle) as BillingCycle;
    if (!Object.values(BillingCycle).includes(billingCycle)) {
      throw new BadRequestException("Invalid billing cycle");
    }

    const newAmount = resolvePlanAmount(newPlan, billingCycle);
    const currentAmount = subscription.amount;
    const isUpgrade = new Prisma.Decimal(newAmount).gt(currentAmount);

    if (isUpgrade) {
      const daysRemaining = this.billingService.getDaysRemaining(
        subscription.currentPeriodEnd,
      );
      const totalDays = this.billingService.getTotalDaysInPeriod(
        subscription.currentPeriodStart,
        subscription.currentPeriodEnd,
      );
      const prorationAmount = this.billingService.calculateProration(
        currentAmount,
        newAmount,
        daysRemaining,
        totalDays,
      );

      return {
        subscription,
        type: "upgrade" as const,
        requiresPayment: prorationAmount.gt(0),
        paymentInfo: {
          subscriptionId: subscription.id,
          newPlanId: dto.newPlanId,
          billingCycle,
          prorationAmount: prorationAmount.toNumber(),
          newAmount: new Prisma.Decimal(newAmount).toNumber(),
          currency: newPlan.currency,
          newPlan,
        },
      };
    }

    // Downgrade: validate current usage against new plan limits first.
    await this.assertDowngradeAllowed(subscription.tenantId, newPlan);

    // Compound WHERE on tenantId + scheduledDowngradePlanId IS NULL.
    // Without the null guard, two admins clicking "Downgrade to Plan B"
    // and "Downgrade to Plan C" within the same millisecond both pass
    // the line 449 null check from the same snapshot and both write —
    // last writer wins, loser's intent silently dropped after they saw
    // a 200. The user closes the tab thinking the downgrade is queued.
    const claim = await this.prisma.subscription.updateMany({
      where: {
        id: subscriptionId,
        tenantId,
        scheduledDowngradePlanId: null,
      },
      data: {
        scheduledDowngradePlanId: dto.newPlanId,
        scheduledDowngradeBillingCycle: billingCycle,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "A scheduled plan change was just registered by another session — refresh and retry.",
      );
    }
    const updatedSubscription =
      await this.prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: { plan: true, scheduledDowngradePlan: true },
      });

    // The downgrade was committed (scheduled for period end); the upgrade
    // branch above only returns a quote (no mutation), so it isn't counted —
    // its committed billing change lands later in applyUpgrade.
    this.recordBillingEvent("change");
    await this.writeBillingAudit(
      tenantId,
      actorUserId,
      "SUBSCRIPTION_PLAN_CHANGED",
      {
        subscriptionId,
        type: "downgrade",
        fromPlanId: currentPlan.id,
        fromPlanName: currentPlan.name,
        toPlanId: newPlan.id,
        toPlanName: newPlan.name,
        billingCycle,
        scheduledFor: subscription.currentPeriodEnd?.toISOString(),
      },
    );
    return {
      subscription: updatedSubscription,
      type: "downgrade" as const,
      requiresPayment: false,
      scheduledFor: subscription.currentPeriodEnd,
      newPlan,
    };
  }

  /**
   * Thin facade over the extracted DowngradeUsageGuardService. Behavior and
   * call sites (changePlan, applyScheduledDowngrade) are unchanged — the
   * usage-count queries and violation-message formatting moved verbatim.
   */
  private async assertDowngradeAllowed(
    tenantId: string,
    newPlan: {
      maxUsers: number;
      maxTables: number;
      maxProducts: number;
      maxCategories: number;
    },
  ) {
    return this.downgradeGuard.assertDowngradeAllowed(tenantId, newPlan);
  }

  /**
   * Apply a scheduled downgrade at period end. Re-runs the usage
   * violation check inside the transaction because days/weeks may have
   * passed since `changePlan` was called.
   */
  async applyScheduledDowngrade(subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, tenant: true, scheduledDowngradePlan: true },
    });
    if (!subscription) throw new NotFoundException("Subscription not found");
    if (
      !subscription.scheduledDowngradePlanId ||
      !subscription.scheduledDowngradePlan
    ) {
      throw new BadRequestException("No scheduled downgrade found");
    }

    const newPlan = subscription.scheduledDowngradePlan;
    await this.assertDowngradeAllowed(subscription.tenantId, newPlan);

    const billingCycle =
      subscription.scheduledDowngradeBillingCycle || subscription.billingCycle;
    const newAmount = resolvePlanAmount(newPlan, billingCycle);

    // deep-review H1: roll the billing period forward as part of the same
    // atomic claim. The downgrade cron runs at 01:00 and the period-end
    // sweep at 02:00 on the same day; without advancing currentPeriodEnd the
    // just-downgraded row still has a past period end, so the 02:00 sweep
    // immediately flips it to PAST_DUE (then EXPIRED after the 7-day grace) —
    // silently dropping a customer who scheduled a downgrade (requiresPayment
    // = false) off the cheaper plan they meant to keep. This is a
    // manual-renewal merchant, and the "scheduled for period end" contract
    // already promises the cheaper plan continues, so granting the next cycle
    // is the correct behaviour.
    const now = new Date();
    const newPeriodEnd =
      billingCycle === BillingCycle.MONTHLY
        ? addMonths(now, 1)
        : addYears(now, 1);

    // v2.8.94 — wrap the claim + tenant.currentPlanId flip + lifecycle
    // event in a single $transaction. Pre-fix the subscription.planId
    // and tenant.currentPlanId could land in separate commits and the
    // SubscriptionDowngraded event was never emitted at all. The
    // engine projector consequently never re-projected grants, so
    // tenants retained their pre-downgrade entitlements until the
    // nightly reconcile cron fired (~24h). Now all three writes
    // commit together or none do.
    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic claim with compound WHERE on scheduledDowngradePlanId NOT
      // NULL. The cron should never fire twice for one subscription, but
      // a manual SuperAdmin re-trigger overlapping the scheduled fire
      // would otherwise re-apply the same downgrade with a fresh
      // `amount` write (idempotent) AND notify the admin twice. The
      // claim makes the loser see count=0 and skip silently.
      const claim = await tx.subscription.updateMany({
        where: {
          id: subscriptionId,
          scheduledDowngradePlanId: { not: null },
        },
        data: {
          planId: subscription.scheduledDowngradePlanId!,
          billingCycle,
          amount: newAmount,
          currency: newPlan.currency,
          // H1: advance the period so the period-end sweep no longer matches
          // this row (its own currentPeriodEnd <= now guard then prevents the
          // downgrade cron re-firing).
          currentPeriodStart: now,
          currentPeriodEnd: newPeriodEnd,
          scheduledDowngradePlanId: null,
          scheduledDowngradeBillingCycle: null,
        },
      });
      if (claim.count === 0) {
        return null;
      }
      const updated = await tx.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: { plan: true },
      });

      await tx.tenant.update({
        where: { id: subscription.tenantId },
        data: { currentPlanId: subscription.scheduledDowngradePlanId },
      });

      await this.emitLifecycle(EventTypes.SubscriptionDowngraded, updated, tx);
      return updated;
    });

    if (result === null) {
      this.logger.debug(
        `Scheduled downgrade for ${subscriptionId} already applied by another run`,
      );
      return null;
    }
    const updated = result;

    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId: subscription.tenantId, role: "ADMIN" },
      select: { email: true },
    });
    if (adminUser?.email) {
      await this.notificationService
        .sendPlanChangeConfirmation(
          adminUser.email,
          subscription.tenant.name,
          newPlan.displayName,
        )
        .catch((err) =>
          this.logger.error(`plan-change notification failed: ${err.message}`),
        );
    }

    this.logger.log(
      `Scheduled downgrade applied for subscription ${subscriptionId} - ${newPlan.displayName}`,
    );
    return updated;
  }

  async getScheduledDowngrade(subscriptionId: string, tenantId: string) {
    // Ownership check via the generic helper, then fetch only what we need.
    await this.getSubscriptionById(subscriptionId, tenantId);
    const withDowngrade = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { scheduledDowngradePlan: true },
    });
    if (!withDowngrade || !withDowngrade.scheduledDowngradePlanId) return null;
    return {
      scheduledPlanId: withDowngrade.scheduledDowngradePlanId,
      scheduledPlan: withDowngrade.scheduledDowngradePlan,
      scheduledBillingCycle: withDowngrade.scheduledDowngradeBillingCycle,
      scheduledFor: withDowngrade.currentPeriodEnd,
    };
  }

  async cancelScheduledDowngrade(subscriptionId: string, tenantId: string) {
    const subscription = await this.getSubscriptionById(
      subscriptionId,
      tenantId,
    );
    if (!subscription.scheduledDowngradePlanId) {
      throw new BadRequestException("No scheduled downgrade found");
    }
    // Compound WHERE on tenantId IDOR + scheduledDowngradePlanId NOT
    // NULL. The race here is benign (two cancels are idempotent) but
    // the tenant guard is the B41-B45 defence-in-depth pattern; the
    // not-null guard surfaces a useful 400 if the cron already
    // applied the downgrade between read and write.
    const claim = await this.prisma.subscription.updateMany({
      where: {
        id: subscriptionId,
        tenantId,
        scheduledDowngradePlanId: { not: null },
      },
      data: {
        scheduledDowngradePlanId: null,
        scheduledDowngradeBillingCycle: null,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Scheduled downgrade no longer exists — it may have just been applied.",
      );
    }
    return { success: true, message: "Scheduled downgrade cancelled" };
  }

  /**
   * Cancel a subscription. We distinguish two lifecycles:
   *   - immediate (admin action / TOS): status flips to CANCELLED, both
   *     `cancelledAt` and `endedAt` are set to now
   *   - at-period-end (user self-cancel): `cancelAtPeriodEnd=true`,
   *     `cancelledAt` records the decision, `endedAt` stays null until
   *     the scheduler runs
   */
  async cancelSubscription(
    subscriptionId: string,
    tenantId: string,
    immediate: boolean = false,
    reason?: string,
    actorUserId?: string,
  ) {
    const subscription = await this.getSubscriptionById(
      subscriptionId,
      tenantId,
    );
    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new BadRequestException("Subscription already cancelled");
    }

    const now = new Date();
    const data: Prisma.SubscriptionUpdateInput = immediate
      ? {
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: now,
          endedAt: now,
          cancellationReason: reason,
        }
      : {
          cancelAtPeriodEnd: true,
          cancelledAt: now,
          cancellationReason: reason,
        };

    // v2.8.89 — atomic currentPlanId flip on immediate cancel.
    // Pre-v2.8.89: status → CANCELLED but Tenant.currentPlanId was left
    // pointing at the paid plan. The entitlement projector then re-
    // projected `plan:BUSINESS` grants on every subsequent
    // SubscriptionCancelled / TenantOverridesChanged event, leaking
    // paid feature access until the nightly reconcile cron caught up.
    // The new projector (plan-projector.service.ts v2.8.89) defends
    // against this by reading Subscription.status alongside
    // currentPlanId, but we still flip currentPlanId here so the
    // tenant row stays honest with the access reality. Wrap in a txn
    // so an interrupted cancellation never leaves
    // (status=CANCELLED, currentPlanId=PAID) on disk.
    const freePlan = immediate
      ? await this.prisma.subscriptionPlan.findUnique({
          where: { name: SubscriptionPlanType.FREE },
          select: { id: true },
        })
      : null;
    // v2.8.94 — fold the post-claim fetch and (immediate path's)
    // lifecycle emit into the same $transaction. Pre-fix the emit
    // happened *after* the txn committed, so a crash between commit
    // and emit left the subscription cancelled with no projector
    // signal — entitlements stayed paid until the nightly reconcile.
    const txResult = await this.prisma.$transaction(async (tx) => {
      const c = await tx.subscription.updateMany({
        where: {
          id: subscriptionId,
          tenantId,
          status: { not: SubscriptionStatus.CANCELLED },
        },
        data,
      });
      if (c.count === 0) {
        return { claimed: false as const };
      }
      if (immediate && freePlan) {
        await tx.tenant.update({
          where: { id: tenantId },
          data: { currentPlanId: freePlan.id },
        });
      }
      const updated = await tx.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: { plan: true, tenant: true },
      });
      // Only "immediate" cancellations terminate access right away;
      // "at period end" leaves the subscription ACTIVE/TRIALING until
      // the scheduler closes it. Emit only when access actually changes.
      if (immediate) {
        await this.emitLifecycle(EventTypes.SubscriptionCancelled, updated, tx);
      }
      return { claimed: true as const, updated };
    });
    if (!txResult.claimed) {
      throw new BadRequestException(
        "Subscription state changed concurrently — refresh and retry.",
      );
    }
    const updated = txResult.updated;
    // Committed cancel (immediate or at-period-end) — recorded after the txn.
    this.recordBillingEvent("cancel");
    await this.writeBillingAudit(
      tenantId,
      actorUserId,
      "SUBSCRIPTION_CANCELLED",
      {
        subscriptionId,
        planId: subscription.planId,
        planName: subscription.plan.name,
        immediate,
        reason,
        effectiveAt: (immediate
          ? now
          : subscription.currentPeriodEnd
        )?.toISOString(),
      },
    );

    // Notifications are user-facing side effects and stay outside the
    // txn — they touch SMTP and can stall for seconds.
    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId: subscription.tenantId, role: "ADMIN" },
      select: { email: true },
    });
    if (adminUser?.email) {
      const endDate = immediate ? now : subscription.currentPeriodEnd;
      const notifyPromise = immediate
        ? this.notificationService.sendSubscriptionCancelledImmediate(
            adminUser.email,
            subscription.tenant.name,
            subscription.plan.displayName,
            reason,
          )
        : this.notificationService.sendSubscriptionWillCancel(
            adminUser.email,
            subscription.tenant.name,
            subscription.plan.displayName,
            endDate,
            reason,
          );
      await notifyPromise.catch((err: any) =>
        this.logger.error(`cancellation notification failed: ${err?.message}`),
      );
    }

    return updated;
  }

  /**
   * Reactivate a subscription that was set to cancel at period end.
   * `cancelledAt` is preserved as "last cancellation decision" audit.
   */
  async reactivateSubscription(subscriptionId: string, tenantId: string) {
    const subscription = await this.getSubscriptionById(
      subscriptionId,
      tenantId,
    );
    if (!subscription.cancelAtPeriodEnd) {
      throw new BadRequestException(
        "Can only reactivate subscriptions that are set to cancel at period end",
      );
    }
    // v2.8.96 — wrap claim + post-fetch + lifecycle emit in one txn.
    // Pre-fix the emit ran AFTER the updateMany committed; a process
    // crash between commit and emit left the subscription reactivated
    // with no SubscriptionActivated signal, so the projector never
    // ran the safety re-projection and a previously-degraded grant
    // could stay degraded until the nightly reconcile.
    //
    // Compound WHERE: tenantId IDOR + cancelAtPeriodEnd=true guard.
    // A concurrent "Cancel immediate" from another admin would already
    // have set status=CANCELLED; reactivating that row would silently
    // flip cancelAtPeriodEnd=false while leaving the subscription
    // CANCELLED — invariant break.
    const txResult = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.subscription.updateMany({
        where: {
          id: subscriptionId,
          tenantId,
          cancelAtPeriodEnd: true,
          status: { not: SubscriptionStatus.CANCELLED },
        },
        data: { cancelAtPeriodEnd: false },
      });
      if (claim.count === 0) {
        return { claimed: false as const };
      }
      const updated = await tx.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: { plan: true },
      });
      // Reactivation restores entitlement access if it had degraded (it usually
      // hasn't — at-period-end keeps ACTIVE — but the projector is cheap and
      // the safe choice is "emit anyway, reproject is idempotent").
      await this.emitLifecycle(EventTypes.SubscriptionActivated, updated, tx);
      return { claimed: true as const, updated };
    });
    if (!txResult.claimed) {
      throw new BadRequestException(
        "Subscription state changed concurrently — refresh and retry.",
      );
    }
    const updated = txResult.updated;
    // Already emitted inside the txn above — preserve the legacy
    // "outer scope `updated` is available" shape for the rest of the
    // function.
    this.recordBillingEvent("reactivate");
    return updated;
  }

  /**
   * Restricted update surface for admin tweaks (cancelAtPeriodEnd, etc).
   * Field whitelisting prevents mass-assignment of financial state like
   * plan, status, amount, currency, trial flags.
   */
  async updateSubscription(
    subscriptionId: string,
    tenantId: string,
    dto: UpdateSubscriptionDto,
  ) {
    await this.getSubscriptionById(subscriptionId, tenantId);
    const data: Prisma.SubscriptionUpdateInput = {};
    if (typeof dto.cancelAtPeriodEnd === "boolean") {
      data.cancelAtPeriodEnd = dto.cancelAtPeriodEnd;
    }
    return this.prisma.subscription.update({
      where: { id: subscriptionId },
      data,
      include: { plan: true },
    });
  }

  async isSubscriptionActive(tenantId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        tenantId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING],
        },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!subscription) return false;
    return subscription.currentPeriodEnd > new Date();
  }

  async getAvailablePlans() {
    // Onboarding-trial redesign: only PUBLIC plans are self-serve purchasable.
    // This excludes the TRIAL onboarding plan (isPublic=false, granted at
    // signup) and the retired FREE plan (isActive=false), so the choose-plan
    // screen lists only BASIC/PRO/BUSINESS.
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: { monthlyPrice: "asc" },
    });

    const now = new Date();
    return plans.map((plan) => {
      const isDiscountActive = isPlanDiscountActive(plan, now);

      // Display pricing uses the SAME resolvePlanAmount the charge rails use, so
      // the advertised discounted price provably equals what gets charged
      // (createSubscription / startTrial / applyUpgrade / confirmDowngrade,
      // checkout quote, havale, create-intent all route through it).
      const discountedMonthly: Prisma.Decimal | null = isDiscountActive
        ? resolvePlanAmount(plan, "MONTHLY", now)
        : null;
      const discountedYearly: Prisma.Decimal | null = isDiscountActive
        ? resolvePlanAmount(plan, "YEARLY", now)
        : null;

      return {
        id: plan.id,
        name: plan.name,
        displayName: plan.displayName,
        description: plan.description,
        monthlyPrice: plan.monthlyPrice,
        yearlyPrice: plan.yearlyPrice,
        currency: plan.currency,
        trialDays: plan.trialDays,
        limits: {
          maxUsers: plan.maxUsers,
          maxTables: plan.maxTables,
          // Drift fix: this mapper mirrors SubscriptionPlan independently of
          // PlanProjectorService.LIMIT_COLUMNS and had fallen out of sync —
          // maxBranches was missing, so the sales-page comparison matrix
          // rendered Number(undefined) → "NaN" in the Şube sayısı cell. See
          // plan-mapper-parity.spec.ts (tripwire pinning this mapper against
          // LIMIT_COLUMNS so a future column addition fails loudly here).
          maxBranches: plan.maxBranches,
          maxProducts: plan.maxProducts,
          maxCategories: plan.maxCategories,
          maxMonthlyOrders: plan.maxMonthlyOrders,
          maxMonthlyAiPhotos: plan.maxMonthlyAiPhotos,
          maxMonthlyAiVideos: plan.maxMonthlyAiVideos,
          maxMonthlyAi3dModels: plan.maxMonthlyAi3dModels,
        },
        features: {
          advancedReports: plan.advancedReports,
          multiLocation: plan.multiLocation,
          customBranding: plan.customBranding,
          apiAccess: plan.apiAccess,
          externalDisplay: plan.externalDisplay,
          prioritySupport: plan.prioritySupport,
          inventoryTracking: plan.inventoryTracking,
          kdsIntegration: plan.kdsIntegration,
          reservationSystem: plan.reservationSystem,
          personnelManagement: plan.personnelManagement,
          deliveryIntegration: plan.deliveryIntegration,
          // Drift fix: posAccess was missing from this mirror (see
          // maxBranches comment above for the same drift class) — the sales
          // page's "POS / Satış ekranı" row showed ✗ for every plan even
          // though BASIC/PRO/BUSINESS grant it. Gating itself was unaffected
          // (SubscriptionContext.hasFeature is fail-closed and reads
          // getEffectiveFeatures, not this endpoint) — this was a display-only
          // drift on the public plan-comparison matrix.
          posAccess: plan.posAccess,
          aiContentGeneration: plan.aiContentGeneration,
        },
        discount: isDiscountActive
          ? {
              percentage: plan.discountPercentage,
              label: plan.discountLabel,
              endDate: plan.discountEndDate?.toISOString(),
              discountedMonthlyPrice: discountedMonthly,
              discountedYearlyPrice: discountedYearly,
            }
          : null,
        isActive: plan.isActive,
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
      };
    });
  }

  /**
   * v2.8.88 — engine-routed effective features.
   *
   * Pre-v2.8.88 this method read `tenant.currentPlan + featureOverrides +
   * limitOverrides` and returned a static plan-only snapshot. The
   * entitlement engine had been populating `feature.*`, `limit.*`,
   * `integration.*` rows from plan + add-on + override sources for
   * months — but the frontend's `useGetEffectiveFeatures` hook (the
   * single source for `hasFeature` / `checkLimit` across the entire UI)
   * never consumed them. Result: a tenant who purchased
   * `integration_yemeksepeti` (₺249/mo) got a successful charge, a
   * projection event, an engine grant, AND no visible effect on their
   * UI. Their entitlement row sat in the DB doing nothing.
   *
   * Now: pull the resolved set from the engine and translate the
   * dotted keys to the camelCase / unprefixed shape the frontend
   * already consumes. Result shape is additive — adds `integrations`
   * — so old frontends keep working.
   *
   * Fallback: if the engine returns an empty set (a tenant whose
   * projector hasn't run yet — e.g. mid-signup race, or a tenant
   * created before reconcileNightly's first pass), we fall through to
   * the legacy plan-only computation so the UI still has SOMETHING to
   * render rather than a blank loading state. Reconcile-nightly catches
   * this within 24h; the projector also reprojects on next mutation.
   */
  async getEffectiveFeatures(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { currentPlan: true },
    });
    if (!tenant || !tenant.currentPlan) {
      throw new NotFoundException("Tenant or plan not found");
    }
    const plan = tenant.currentPlan;

    // Per-plan trial eligibility — the UI uses this to surface a
    // "14 gün ücretsiz dene" CTA on each plan card the tenant hasn't
    // trialed yet. Paid plans only (FREE has trialDays=0 anyway).
    const allPaidPlans = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true, name: { not: SubscriptionPlanType.FREE } },
      select: { id: true, trialDays: true },
    });
    const usedTrialPlanIds = tenant.usedTrialPlanIds ?? [];
    const trialEligiblePlanIds = allPaidPlans
      .filter((p) => p.trialDays > 0 && !usedTrialPlanIds.includes(p.id))
      .map((p) => p.id);

    // Pull the engine-resolved view. tenant-scoped (branchId=null);
    // per-branch entitlements would surface here when a future caller
    // asks for them, but the existing `useGetEffectiveFeatures` is a
    // tenant-level hook so tenant scope is correct.
    const engineSet = await this.entitlements.getForTenant(tenantId, null);
    const hasAnyEngineGrants =
      Object.keys(engineSet.features).length > 0 ||
      Object.keys(engineSet.limits).length > 0 ||
      Object.keys(engineSet.integrations).length > 0;

    if (!hasAnyEngineGrants) {
      // Engine empty — projector hasn't run for this tenant yet. Fall
      // through to plan + override + add-on fold computation so the UI
      // still renders. v2.8.90 — the fold now reads active TenantAddOn
      // rows so a tenant who purchased an add-on but hit a projector
      // race sees their purchase reflected; pre-v2.8.90 this branch
      // returned plan-only and the frontend showed locked features.
      // reconcileNightly still catches the engine miss within 24h.
      this.logger.debug(
        `getEffectiveFeatures fell back to plan + override + addon fold for tenant=${tenantId} (engine empty)`,
      );
      // Engine-empty fallback fold extracted to a pure, tested helper
      // (effective-features.fold.ts) — mirrors PlanProjectorService's
      // FEATURE_COLUMNS/LIMIT_COLUMNS in one named place.
      // Wave D — include `past_due` so the engine-empty fallback matches the
      // projector: a recurring add-on whose period lapsed keeps its grant
      // through the grace window (mirrors Subscription PAST_DUE). Only
      // `cancelled` / `expired` drop out.
      const activeAddOns = await this.prisma.tenantAddOn.findMany({
        where: { tenantId, status: { in: ["active", "past_due"] } },
        include: { addOn: { select: { grants: true } } },
      });
      const folded = foldPlanGrants(
        plan,
        activeAddOns.map((ta) => ({
          grants: (ta.addOn?.grants ?? null) as Record<string, unknown> | null,
          quantity: ta.quantity,
        })),
        (tenant.featureOverrides as Record<string, boolean>) || null,
        (tenant.limitOverrides as Record<string, number>) || null,
      );
      return { ...folded, trialEligiblePlanIds };
    }

    // Engine-resolved path: strip the `feature.` / `limit.` /
    // `integration.` prefixes to match the frontend's shape. Engine
    // keys are dotted ("feature.multiLocation", "limit.maxTables",
    // "integration.delivery"); the response shape this method has
    // shipped for ~6 months is flat camelCase ({ features: {
    // multiLocation }, limits: { maxTables }, integrations: { delivery
    // } }). The unprefix step keeps backwards compat for every
    // existing consumer.
    const features: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(engineSet.features)) {
      const unprefixed = k.startsWith("feature.")
        ? k.slice("feature.".length)
        : k;
      features[unprefixed] = v;
    }
    const limits: Record<string, number> = {};
    for (const [k, v] of Object.entries(engineSet.limits)) {
      const unprefixed = k.startsWith("limit.") ? k.slice("limit.".length) : k;
      limits[unprefixed] = v;
    }
    const integrations: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(engineSet.integrations)) {
      const unprefixed = k.startsWith("integration.")
        ? k.slice("integration.".length)
        : k;
      integrations[unprefixed] = v;
    }

    return { features, limits, integrations, trialEligiblePlanIds };
  }

  async getPlanByName(name: SubscriptionPlanType) {
    return this.prisma.subscriptionPlan.findUnique({ where: { name } });
  }

  /**
   * Trial expiry cron. Trials don't auto-charge at expiry — the onboarding
   * trial LOCKS: each expired TRIALING row flips to TRIAL_ENDED (no plan
   * change, no FREE landing), which the status guards treat as not-live so the
   * app is gated to plan-selection + checkout. The admin is emailed to pick a
   * plan. Each row is wrapped in try/catch so one bad tenant does not skip
   * everyone else's expiry.
   */
  async expireTrials(): Promise<{ processed: number; failed: number }> {
    const now = new Date();
    const expiredTrials = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.TRIALING,
        isTrialPeriod: true,
        trialEnd: { lte: now },
      },
      include: { plan: true, tenant: true },
    });

    if (expiredTrials.length === 0) {
      return { processed: 0, failed: 0 };
    }

    let failed = 0;
    // deep-review H2: rows that were concurrently paid/cancelled between the
    // findMany snapshot and the per-row claim are skipped, not failed.
    let skipped = 0;
    for (const subscription of expiredTrials) {
      try {
        // Onboarding-trial redesign: at expiry the trial does NOT downgrade to
        // a plan — it LOCKS. Flip TRIALING → TRIAL_ENDED (status only; the plan
        // pointer stays TRIAL, no FREE landing). The global
        // SubscriptionStatusGuard + PlanFeatureGuard then gate the app to the
        // plan-selection + checkout flow until a paid plan is activated.
        //
        // H2 atomic CONDITIONAL claim: only a row STILL TRIALING transitions.
        // If a PayTR webhook flipped it to ACTIVE+paid after the findMany
        // snapshot, claim.count===0 and we leave the just-paid subscription
        // untouched (never lock a tenant that already paid).
        const claim = await this.prisma.subscription.updateMany({
          where: {
            id: subscription.id,
            status: SubscriptionStatus.TRIALING,
            isTrialPeriod: true,
          },
          data: {
            status: SubscriptionStatus.TRIAL_ENDED,
            isTrialPeriod: false,
          },
        });

        if (claim.count === 0) {
          skipped += 1;
          this.logger.log(
            `Trial ${subscription.id} skipped — no longer TRIALING (concurrently settled/cancelled)`,
          );
          continue;
        }

        this.logger.log(
          `Trial subscription ${subscription.id} expired → tenant ${subscription.tenantId} LOCKED (TRIAL_ENDED); must activate a paid plan`,
        );

        // The subscription is no longer live, so re-project entitlements to
        // revoke the trial grants. (The status guard is the hard lock; this
        // keeps the entitlement set consistent with the locked state.)
        await this.emitLifecycle(EventTypes.SubscriptionDowngraded, {
          id: subscription.id,
          tenantId: subscription.tenantId,
          plan: { name: subscription.plan.name },
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
        });

        // Best-effort trial-expired email; failure here mustn't block the
        // status transition (the cron must remain idempotent).
        const admin = await this.prisma.user.findFirst({
          where: { tenantId: subscription.tenantId, role: "ADMIN" },
          select: { email: true },
        });
        if (admin?.email) {
          await this.notificationService
            .sendTrialExpired(
              admin.email,
              subscription.tenant.name,
              subscription.plan.displayName,
            )
            .catch((err: any) =>
              this.logger.error(
                `trial-expired notification failed for sub ${subscription.id}: ${err?.message}`,
              ),
            );
        }
      } catch (err: any) {
        failed += 1;
        this.logger.error(
          `Failed to expire trial ${subscription.id}: ${err?.message}`,
        );
      }
    }
    // processed = rows actually transitioned to FREE; skipped rows were
    // concurrently paid/cancelled and are intentionally excluded from both.
    return { processed: expiredTrials.length - failed - skipped, failed };
  }
}
