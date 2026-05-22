import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { addDays, addMonths, addYears } from "date-fns";
import { PrismaService } from "../../../prisma/prisma.service";
import { BillingService } from "./billing.service";
import { NotificationService } from "./notification.service";
import {
  SubscriptionStatus,
  BillingCycle,
  PaymentProvider,
  SubscriptionPlanType,
} from "../../../common/constants/subscription.enum";
import { CreateSubscriptionDto } from "../dto/create-subscription.dto";
import { ChangePlanDto } from "../dto/change-plan.dto";
import { UpdateSubscriptionDto } from "../dto/update-subscription.dto";

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private prisma: PrismaService,
    private billingService: BillingService,
    private notificationService: NotificationService,
  ) {}

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

  async createSubscription(tenantId: string, dto: CreateSubscriptionDto) {
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

    // Trial is a LIFETIME-PER-TENANT benefit. `Tenant.trialUsed` is the
    // canonical gate — once any plan has been trialed (including the
    // BUSINESS trial auto-started at registration), no further trials
    // are available regardless of which paid plan the caller targets.
    // We still write `usedTrialPlanIds` further down for audit, but the
    // eligibility check is per-tenant, not per-plan.
    const hasUsedAnyTrial = tenant.trialUsed === true;
    const canUseTrial =
      !hasUsedAnyTrial &&
      plan.trialDays > 0 &&
      plan.name !== SubscriptionPlanType.FREE;
    const isTrialPeriod = canUseTrial;

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

    const amount =
      dto.billingCycle === BillingCycle.MONTHLY
        ? plan.monthlyPrice
        : plan.yearlyPrice;

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

    // Lifetime-per-tenant eligibility check (mirrors PaymentsService) so
    // direct callers don't bypass the once-per-tenant rule.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { trialUsed: true },
    });
    if (!tenant) {
      throw new NotFoundException("Tenant not found");
    }
    if (tenant.trialUsed === true) {
      throw new BadRequestException(
        "Tenant has already used their trial. Trials are once per account.",
      );
    }

    const now = new Date();
    const trialEnd = addDays(now, plan.trialDays);
    const amount =
      billingCycle === BillingCycle.MONTHLY
        ? plan.monthlyPrice
        : plan.yearlyPrice;

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
  ) {
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

    const newAmount =
      billingCycle === BillingCycle.MONTHLY
        ? newPlan.monthlyPrice
        : newPlan.yearlyPrice;
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
        'A scheduled plan change was just registered by another session — refresh and retry.',
      );
    }
    const updatedSubscription = await this.prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { plan: true, scheduledDowngradePlan: true },
    });

    return {
      subscription: updatedSubscription,
      type: "downgrade" as const,
      requiresPayment: false,
      scheduledFor: subscription.currentPeriodEnd,
      newPlan,
    };
  }

  private async assertDowngradeAllowed(
    tenantId: string,
    newPlan: {
      maxUsers: number;
      maxTables: number;
      maxProducts: number;
      maxCategories: number;
    },
  ) {
    const usage = await this.getCurrentUsage(tenantId);
    const violations: string[] = [];
    if (newPlan.maxUsers !== -1 && usage.users > newPlan.maxUsers) {
      violations.push(`Users: ${usage.users}/${newPlan.maxUsers}`);
    }
    if (newPlan.maxTables !== -1 && usage.tables > newPlan.maxTables) {
      violations.push(`Tables: ${usage.tables}/${newPlan.maxTables}`);
    }
    if (newPlan.maxProducts !== -1 && usage.products > newPlan.maxProducts) {
      violations.push(`Products: ${usage.products}/${newPlan.maxProducts}`);
    }
    if (
      newPlan.maxCategories !== -1 &&
      usage.categories > newPlan.maxCategories
    ) {
      violations.push(
        `Categories: ${usage.categories}/${newPlan.maxCategories}`,
      );
    }
    if (violations.length > 0) {
      throw new BadRequestException(
        `Cannot downgrade: current usage exceeds new plan limits. Please reduce: ${violations.join(", ")}`,
      );
    }
  }

  private async getCurrentUsage(tenantId: string) {
    const [users, tables, products, categories] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, status: "ACTIVE" } }),
      this.prisma.table.count({ where: { tenantId } }),
      this.prisma.product.count({ where: { tenantId } }),
      this.prisma.category.count({ where: { tenantId } }),
    ]);
    return { users, tables, products, categories };
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
    const newAmount =
      billingCycle === BillingCycle.MONTHLY
        ? newPlan.monthlyPrice
        : newPlan.yearlyPrice;

    // Atomic claim with compound WHERE on scheduledDowngradePlanId NOT
    // NULL. The cron should never fire twice for one subscription, but
    // a manual SuperAdmin re-trigger overlapping the scheduled fire
    // would otherwise re-apply the same downgrade with a fresh
    // `amount` write (idempotent) AND notify the admin twice. The
    // claim makes the loser see count=0 and skip silently.
    const claim = await this.prisma.subscription.updateMany({
      where: {
        id: subscriptionId,
        scheduledDowngradePlanId: { not: null },
      },
      data: {
        planId: subscription.scheduledDowngradePlanId,
        billingCycle,
        amount: newAmount,
        currency: newPlan.currency,
        scheduledDowngradePlanId: null,
        scheduledDowngradeBillingCycle: null,
      },
    });
    if (claim.count === 0) {
      this.logger.debug(
        `Scheduled downgrade for ${subscriptionId} already applied by another run`,
      );
      return null;
    }
    const updated = await this.prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { plan: true },
    });

    await this.prisma.tenant.update({
      where: { id: subscription.tenantId },
      data: { currentPlanId: subscription.scheduledDowngradePlanId },
    });

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
        'Scheduled downgrade no longer exists — it may have just been applied.',
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

    // Manual-renewal model: no PayTR-side token to revoke (we never
    // store one), no auto-renew flag to flip off. Cancellation is now
    // a single subscription update.
    //
    // Compound WHERE: tenantId IDOR defence-in-depth + status not
    // already CANCELLED. Without the status guard, two admins clicking
    // "Cancel immediate" and "Cancel at period end" within the same
    // millisecond both pass the status check above, then one writes
    // status=CANCELLED + endedAt and the other writes
    // cancelAtPeriodEnd=true on the now-CANCELLED row — landing the
    // subscription with cancelAtPeriodEnd=true AND status=CANCELLED,
    // which the period-end cron then re-cancels at period boundary,
    // sending a confusing follow-up email.
    const claim = await this.prisma.subscription.updateMany({
      where: {
        id: subscriptionId,
        tenantId,
        status: { not: SubscriptionStatus.CANCELLED },
      },
      data,
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        'Subscription state changed concurrently — refresh and retry.',
      );
    }
    const updated = await this.prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { plan: true, tenant: true },
    });

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
    // Compound WHERE: tenantId IDOR + cancelAtPeriodEnd=true guard.
    // A concurrent "Cancel immediate" from another admin would already
    // have set status=CANCELLED; reactivating that row would silently
    // flip cancelAtPeriodEnd=false while leaving the subscription
    // CANCELLED — invariant break.
    const claim = await this.prisma.subscription.updateMany({
      where: {
        id: subscriptionId,
        tenantId,
        cancelAtPeriodEnd: true,
        status: { not: SubscriptionStatus.CANCELLED },
      },
      data: { cancelAtPeriodEnd: false },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        'Subscription state changed concurrently — refresh and retry.',
      );
    }
    const updated = await this.prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { plan: true },
    });
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
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPrice: "asc" },
    });

    const now = new Date();
    return plans.map((plan) => {
      const isDiscountActive =
        plan.isDiscountActive &&
        plan.discountPercentage &&
        plan.discountStartDate &&
        plan.discountEndDate &&
        plan.discountStartDate <= now &&
        plan.discountEndDate >= now;

      // Display-only pricing; createSubscription / applyUpgrade re-apply
      // any active discount server-side as source of truth.
      let discountedMonthly: Prisma.Decimal | null = null;
      let discountedYearly: Prisma.Decimal | null = null;
      if (isDiscountActive) {
        const multiplier = new Prisma.Decimal(
          100 - plan.discountPercentage!,
        ).div(100);
        discountedMonthly = new Prisma.Decimal(plan.monthlyPrice)
          .mul(multiplier)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        discountedYearly = new Prisma.Decimal(plan.yearlyPrice)
          .mul(multiplier)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      }

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
          maxProducts: plan.maxProducts,
          maxCategories: plan.maxCategories,
          maxMonthlyOrders: plan.maxMonthlyOrders,
        },
        features: {
          advancedReports: plan.advancedReports,
          multiLocation: plan.multiLocation,
          customBranding: plan.customBranding,
          apiAccess: plan.apiAccess,
          prioritySupport: plan.prioritySupport,
          inventoryTracking: plan.inventoryTracking,
          kdsIntegration: plan.kdsIntegration,
          reservationSystem: plan.reservationSystem,
          personnelManagement: plan.personnelManagement,
          deliveryIntegration: plan.deliveryIntegration,
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

  async getEffectiveFeatures(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { currentPlan: true },
    });
    if (!tenant || !tenant.currentPlan) {
      throw new NotFoundException("Tenant or plan not found");
    }
    const plan = tenant.currentPlan;
    const featureOverrides =
      (tenant.featureOverrides as Record<string, boolean>) || null;
    const limitOverrides =
      (tenant.limitOverrides as Record<string, number>) || null;

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

    const features = {
      advancedReports:
        featureOverrides?.advancedReports ?? plan.advancedReports,
      multiLocation: featureOverrides?.multiLocation ?? plan.multiLocation,
      customBranding: featureOverrides?.customBranding ?? plan.customBranding,
      apiAccess: featureOverrides?.apiAccess ?? plan.apiAccess,
      prioritySupport:
        featureOverrides?.prioritySupport ?? plan.prioritySupport,
      inventoryTracking:
        featureOverrides?.inventoryTracking ?? plan.inventoryTracking,
      kdsIntegration: featureOverrides?.kdsIntegration ?? plan.kdsIntegration,
      reservationSystem:
        featureOverrides?.reservationSystem ?? plan.reservationSystem,
      personnelManagement:
        featureOverrides?.personnelManagement ?? plan.personnelManagement,
      deliveryIntegration:
        featureOverrides?.deliveryIntegration ?? plan.deliveryIntegration,
    };
    const limits = {
      maxUsers: limitOverrides?.maxUsers ?? plan.maxUsers,
      maxTables: limitOverrides?.maxTables ?? plan.maxTables,
      maxProducts: limitOverrides?.maxProducts ?? plan.maxProducts,
      maxCategories: limitOverrides?.maxCategories ?? plan.maxCategories,
      maxMonthlyOrders:
        limitOverrides?.maxMonthlyOrders ?? plan.maxMonthlyOrders,
    };
    return { features, limits, trialEligiblePlanIds };
  }

  async getPlanByName(name: SubscriptionPlanType) {
    return this.prisma.subscriptionPlan.findUnique({ where: { name } });
  }

  /**
   * Trial expiry cron. Trials don't auto-charge at expiry — we move them
   * to PAST_DUE (so the tenant keeps read-only access) and notify the
   * admin to re-checkout. Each row is wrapped in try/catch so one bad
   * tenant does not skip everyone else's expiry.
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

    // Look up FREE once for the whole batch. If the seed is missing
    // FREE the entire batch fails loudly; no per-row fallback because
    // there's no sensible alternative target.
    const freePlan = await this.prisma.subscriptionPlan.findUnique({
      where: { name: "FREE" },
    });
    if (!freePlan) {
      this.logger.error(
        "FREE plan missing from catalog — cannot expire trials",
      );
      return { processed: 0, failed: expiredTrials.length };
    }

    // FREE has no real period boundary, but currentPeriodEnd is a
    // non-null column. Project ~10 years out, matching the placeholder
    // AuthService.register used to write for the FREE subscription it
    // created at signup. Same intent: the column exists for plan-tier
    // bookkeeping, not for a real billing cycle.
    const freePeriodEnd = new Date(now);
    freePeriodEnd.setFullYear(freePeriodEnd.getFullYear() + 10);

    let failed = 0;
    for (const subscription of expiredTrials) {
      try {
        // Atomic transition: move the SAME subscription row from TRIALING
        // BUSINESS → ACTIVE FREE and update Tenant.currentPlanId in lock
        // step. Reusing the row avoids tripping the partial-unique
        // (tenantId) WHERE status IN (ACTIVE, TRIALING) index, which
        // would fire if we tried to create a fresh FREE row alongside
        // the TRIALING one.
        await this.prisma.$transaction(async (tx) => {
          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              planId: freePlan.id,
              status: SubscriptionStatus.ACTIVE,
              isTrialPeriod: false,
              amount: 0,
              currency: freePlan.currency,
              currentPeriodStart: now,
              currentPeriodEnd: freePeriodEnd,
            },
          });
          await tx.tenant.update({
            where: { id: subscription.tenantId },
            data: { currentPlanId: freePlan.id },
          });
        });
        this.logger.log(
          `Trial subscription ${subscription.id} expired → tenant ${subscription.tenantId} dropped to FREE`,
        );

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
    return { processed: expiredTrials.length - failed, failed };
  }
}
