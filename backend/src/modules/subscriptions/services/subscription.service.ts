import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addDays, addMonths, addYears } from 'date-fns';
import { PrismaService } from '../../../prisma/prisma.service';
import { BillingService } from './billing.service';
import { NotificationService } from './notification.service';
import {
  SubscriptionStatus,
  BillingCycle,
  PaymentProvider,
  SubscriptionPlanType,
} from '../../../common/constants/subscription.enum';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';
import { ChangePlanDto } from '../dto/change-plan.dto';
import { UpdateSubscriptionDto } from '../dto/update-subscription.dto';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private prisma: PrismaService,
    private billingService: BillingService,
    private notificationService: NotificationService,
  ) {}

  /**
   * Latest subscription row for a tenant, regardless of status. Callers
   * decide how to present PAST_DUE / EXPIRED / CANCELLED states; returning
   * `null` only for tenants that have never subscribed avoids the
   * dead-end "no subscription → try to create → already has one" UX.
   */
  async getCurrentSubscription(tenantId: string) {
    return this.prisma.subscription.findFirst({
      where: { tenantId },
      include: {
        plan: true,
        payments: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
      orderBy: { createdAt: 'desc' },
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
        payments: { orderBy: { createdAt: 'desc' } },
        invoices: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    if (tenantId && subscription.tenantId !== tenantId) {
      throw new NotFoundException('Subscription not found');
    }
    return subscription;
  }

  async createSubscription(tenantId: string, dto: CreateSubscriptionDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId, role: 'ADMIN' },
    });
    if (!adminUser) {
      throw new NotFoundException('Admin user not found for this tenant');
    }
    if (!adminUser.emailVerified) {
      throw new BadRequestException(
        'Email must be verified before creating a subscription. ' +
          'Please check your email for the 6-digit verification code.',
      );
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });
    if (!plan || !plan.isActive) {
      throw new NotFoundException('Plan not found or inactive');
    }
    if (!Object.values(BillingCycle).includes(dto.billingCycle as BillingCycle)) {
      throw new BadRequestException('Invalid billing cycle');
    }

    const canUseTrial =
      !tenant.trialUsed &&
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
      dto.billingCycle === BillingCycle.MONTHLY ? plan.monthlyPrice : plan.yearlyPrice;

    // Transaction: subscription + tenant + (optional) pricing snapshot.
    // The DB has a partial unique index on (tenantId) where status IN
    // (ACTIVE, TRIALING), so any concurrent create throws P2002 and the
    // loser's changes are rolled back.
    try {
      return await this.prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.create({
          data: {
            tenantId,
            planId: dto.planId,
            status: isTrialPeriod ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
            billingCycle: dto.billingCycle,
            paymentProvider: PaymentProvider.EMAIL,
            startDate: now,
            currentPeriodStart,
            currentPeriodEnd,
            isTrialPeriod,
            trialStart,
            trialEnd,
            amount,
            currency: plan.currency,
            autoRenew: true,
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
          },
        });

        return subscription;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('Tenant already has an active subscription');
      }
      throw err;
    }
  }

  /**
   * Compute the impact of a plan change without mutating state.
   * Returns either a downgrade scheduled for period end, or the
   * proration numbers the admin needs to collect off-platform before
   * an upgrade can be applied via `applyUpgrade`.
   */
  async changePlan(subscriptionId: string, tenantId: string, dto: ChangePlanDto) {
    const subscription = await this.getSubscriptionById(subscriptionId, tenantId);

    const currentPlan = subscription.plan;
    const newPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.newPlanId },
    });
    if (!newPlan || !newPlan.isActive) {
      throw new NotFoundException('New plan not found or inactive');
    }
    if (subscription.planId === dto.newPlanId) {
      throw new BadRequestException('Already subscribed to this plan');
    }
    if (subscription.scheduledDowngradePlanId) {
      throw new BadRequestException(
        'There is already a scheduled plan change. Please cancel it first.',
      );
    }
    // Cross-currency plan changes don't have meaningful proration math;
    // refuse them instead of silently producing a garbage diff.
    if (currentPlan.currency !== newPlan.currency) {
      throw new BadRequestException(
        'Plan currency change is not supported. Contact support to switch currencies.',
      );
    }

    const billingCycle = (dto.billingCycle || subscription.billingCycle) as BillingCycle;
    if (!Object.values(BillingCycle).includes(billingCycle)) {
      throw new BadRequestException('Invalid billing cycle');
    }

    const newAmount =
      billingCycle === BillingCycle.MONTHLY ? newPlan.monthlyPrice : newPlan.yearlyPrice;
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
        type: 'upgrade' as const,
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

    const updatedSubscription = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        scheduledDowngradePlanId: dto.newPlanId,
        scheduledDowngradeBillingCycle: billingCycle,
      },
      include: { plan: true, scheduledDowngradePlan: true },
    });

    return {
      subscription: updatedSubscription,
      type: 'downgrade' as const,
      requiresPayment: false,
      scheduledFor: subscription.currentPeriodEnd,
      newPlan,
    };
  }

  private async assertDowngradeAllowed(
    tenantId: string,
    newPlan: { maxUsers: number; maxTables: number; maxProducts: number; maxCategories: number },
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
    if (newPlan.maxCategories !== -1 && usage.categories > newPlan.maxCategories) {
      violations.push(`Categories: ${usage.categories}/${newPlan.maxCategories}`);
    }
    if (violations.length > 0) {
      throw new BadRequestException(
        `Cannot downgrade: current usage exceeds new plan limits. Please reduce: ${violations.join(', ')}`,
      );
    }
  }

  /**
   * Promote an upgrade after the admin has collected payment off-platform.
   * Called by SuperAdmin or by a future webhook; idempotent via
   * externalReference on the recorded SubscriptionPayment.
   */
  async applyUpgrade(
    subscriptionId: string,
    tenantId: string,
    newPlanId: string,
    billingCycleRaw: string,
    externalReference?: string,
  ) {
    if (!Object.values(BillingCycle).includes(billingCycleRaw as BillingCycle)) {
      throw new BadRequestException('Invalid billing cycle');
    }
    const billingCycle = billingCycleRaw as BillingCycle;

    const subscription = await this.getSubscriptionById(subscriptionId, tenantId);
    const newPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: newPlanId },
    });
    if (!newPlan) {
      throw new NotFoundException('New plan not found');
    }
    if (subscription.plan.currency !== newPlan.currency) {
      throw new BadRequestException('Plan currency change is not supported');
    }

    const newAmount =
      billingCycle === BillingCycle.MONTHLY ? newPlan.monthlyPrice : newPlan.yearlyPrice;

    return this.prisma.$transaction(async (tx) => {
      // Idempotency: if we've already recorded this externalReference, bail.
      if (externalReference) {
        const dup = await tx.subscriptionPayment.findUnique({
          where: { externalReference },
        });
        if (dup) {
          return tx.subscription.findUnique({
            where: { id: subscriptionId },
            include: { plan: true },
          });
        }
      }

      // Reset the billing period so the new plan's cadence starts from now.
      const now = new Date();
      const newPeriodEnd =
        billingCycle === BillingCycle.MONTHLY ? addMonths(now, 1) : addYears(now, 1);

      const updated = await tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          planId: newPlanId,
          billingCycle,
          amount: newAmount,
          currency: newPlan.currency,
          currentPeriodStart: now,
          currentPeriodEnd: newPeriodEnd,
        },
        include: { plan: true },
      });

      await tx.tenant.update({
        where: { id: subscription.tenantId },
        data: { currentPlanId: newPlanId },
      });

      // Audit row: we took payment (or confirmed) for this upgrade.
      const payment = await tx.subscriptionPayment.create({
        data: {
          subscriptionId,
          amount: newAmount,
          currency: newPlan.currency,
          status: 'SUCCEEDED',
          paymentProvider: PaymentProvider.EMAIL,
          externalReference,
          paidAt: now,
        },
      });

      await this.billingService.createInvoice(
        tx,
        subscriptionId,
        payment.id,
        newAmount,
        newPlan.currency,
        now,
        newPeriodEnd,
        `Upgrade to ${newPlan.displayName}`,
      );

      return updated;
    });
  }

  private async getCurrentUsage(tenantId: string) {
    const [users, tables, products, categories] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, status: 'ACTIVE' } }),
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
    if (!subscription) throw new NotFoundException('Subscription not found');
    if (!subscription.scheduledDowngradePlanId || !subscription.scheduledDowngradePlan) {
      throw new BadRequestException('No scheduled downgrade found');
    }

    const newPlan = subscription.scheduledDowngradePlan;
    await this.assertDowngradeAllowed(subscription.tenantId, newPlan);

    const billingCycle =
      subscription.scheduledDowngradeBillingCycle || subscription.billingCycle;
    const newAmount =
      billingCycle === BillingCycle.MONTHLY ? newPlan.monthlyPrice : newPlan.yearlyPrice;

    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        planId: subscription.scheduledDowngradePlanId,
        billingCycle,
        amount: newAmount,
        currency: newPlan.currency,
        scheduledDowngradePlanId: null,
        scheduledDowngradeBillingCycle: null,
      },
      include: { plan: true },
    });

    await this.prisma.tenant.update({
      where: { id: subscription.tenantId },
      data: { currentPlanId: subscription.scheduledDowngradePlanId },
    });

    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId: subscription.tenantId, role: 'ADMIN' },
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
    const subscription = await this.getSubscriptionById(subscriptionId, tenantId);
    if (!subscription.scheduledDowngradePlanId) {
      throw new BadRequestException('No scheduled downgrade found');
    }
    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        scheduledDowngradePlanId: null,
        scheduledDowngradeBillingCycle: null,
      },
    });
    return { success: true, message: 'Scheduled downgrade cancelled' };
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
    const subscription = await this.getSubscriptionById(subscriptionId, tenantId);
    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new BadRequestException('Subscription already cancelled');
    }

    const now = new Date();
    const data: Prisma.SubscriptionUpdateInput = immediate
      ? {
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: now,
          endedAt: now,
          autoRenew: false,
          cancellationReason: reason,
        }
      : {
          cancelAtPeriodEnd: true,
          autoRenew: false,
          cancelledAt: now,
          cancellationReason: reason,
        };

    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data,
      include: { plan: true, tenant: true },
    });

    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId: subscription.tenantId, role: 'ADMIN' },
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
    const subscription = await this.getSubscriptionById(subscriptionId, tenantId);
    if (!subscription.cancelAtPeriodEnd) {
      throw new BadRequestException(
        'Can only reactivate subscriptions that are set to cancel at period end',
      );
    }
    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        cancelAtPeriodEnd: false,
        autoRenew: true,
      },
      include: { plan: true },
    });
    return updated;
  }

  /**
   * Restricted update surface for admin tweaks (autoRenew, etc). Field
   * whitelisting prevents mass-assignment of financial state like plan,
   * status, amount, currency, trial flags.
   */
  async updateSubscription(
    subscriptionId: string,
    tenantId: string,
    dto: UpdateSubscriptionDto,
  ) {
    await this.getSubscriptionById(subscriptionId, tenantId);
    const data: Prisma.SubscriptionUpdateInput = {};
    if (typeof dto.autoRenew === 'boolean') data.autoRenew = dto.autoRenew;
    if (typeof dto.cancelAtPeriodEnd === 'boolean') {
      data.cancelAtPeriodEnd = dto.cancelAtPeriodEnd;
    }
    return this.prisma.subscription.update({
      where: { id: subscriptionId },
      data,
      include: { plan: true },
    });
  }

  /**
   * Scheduler entry point. In the current contact-based flow there is
   * no in-band payment capture, so a renewal attempt cannot magically
   * charge the tenant — instead we drop the subscription to PAST_DUE
   * and let the ops team (or the tenant's admin via the contact flow)
   * resolve it. Previously this silently flipped status back to ACTIVE,
   * which was an "unlimited free renewals" bug.
   */
  async renewSubscription(subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, tenant: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');
    if (!subscription.autoRenew) return null;

    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: SubscriptionStatus.PAST_DUE },
      include: { plan: true },
    });

    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId: subscription.tenantId, role: 'ADMIN' },
      select: { email: true },
    });
    if (adminUser?.email) {
      await this.notificationService
        .sendPaymentFailed(
          adminUser.email,
          subscription.tenant.name,
          Number(subscription.amount),
          'Subscription renewal requires manual payment confirmation',
        )
        .catch((err: any) =>
          this.logger.error(`payment-failed notification failed: ${err?.message}`),
        );
    }

    this.logger.log(
      `Subscription ${subscriptionId} marked PAST_DUE (contact-based renewal required)`,
    );
    return updated;
  }

  /**
   * Mark a subscription as paid for the next period. Called by
   * SuperAdmin after confirming off-platform payment (WhatsApp/Email).
   */
  async confirmContactRenewal(
    subscriptionId: string,
    externalReference?: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!subscription) throw new NotFoundException('Subscription not found');

    const now = new Date();
    const newPeriodStart = now;
    const newPeriodEnd =
      subscription.billingCycle === BillingCycle.MONTHLY
        ? addMonths(now, 1)
        : addYears(now, 1);

    return this.prisma.$transaction(async (tx) => {
      if (externalReference) {
        const dup = await tx.subscriptionPayment.findUnique({
          where: { externalReference },
        });
        if (dup) {
          return tx.subscription.findUnique({
            where: { id: subscriptionId },
            include: { plan: true },
          });
        }
      }

      const payment = await tx.subscriptionPayment.create({
        data: {
          subscriptionId,
          amount: subscription.amount,
          currency: subscription.currency,
          status: 'SUCCEEDED',
          paymentProvider: PaymentProvider.EMAIL,
          externalReference,
          paidAt: now,
        },
      });

      await this.billingService.createInvoice(
        tx,
        subscriptionId,
        payment.id,
        subscription.amount,
        subscription.currency,
        newPeriodStart,
        newPeriodEnd,
        `Renewal — ${subscription.plan.displayName}`,
      );

      return tx.subscription.update({
        where: { id: subscriptionId },
        data: {
          status: SubscriptionStatus.ACTIVE,
          isTrialPeriod: false,
          currentPeriodStart: newPeriodStart,
          currentPeriodEnd: newPeriodEnd,
        },
        include: { plan: true },
      });
    });
  }

  async isSubscriptionActive(tenantId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        tenantId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) return false;
    return subscription.currentPeriodEnd > new Date();
  }

  async getAvailablePlans() {
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPrice: 'asc' },
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
        const multiplier = new Prisma.Decimal(100 - plan.discountPercentage!).div(100);
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
      throw new NotFoundException('Tenant or plan not found');
    }
    const plan = tenant.currentPlan;
    const featureOverrides =
      (tenant.featureOverrides as Record<string, boolean>) || null;
    const limitOverrides =
      (tenant.limitOverrides as Record<string, number>) || null;

    const features = {
      advancedReports: featureOverrides?.advancedReports ?? plan.advancedReports,
      multiLocation: featureOverrides?.multiLocation ?? plan.multiLocation,
      customBranding: featureOverrides?.customBranding ?? plan.customBranding,
      apiAccess: featureOverrides?.apiAccess ?? plan.apiAccess,
      prioritySupport: featureOverrides?.prioritySupport ?? plan.prioritySupport,
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
      maxMonthlyOrders: limitOverrides?.maxMonthlyOrders ?? plan.maxMonthlyOrders,
    };
    return { features, limits };
  }

  async getPlanByName(name: SubscriptionPlanType) {
    return this.prisma.subscriptionPlan.findUnique({ where: { name } });
  }

  /**
   * Trial expiry cron. In the current contact-based model trials don't
   * auto-convert — they simply move to PAST_DUE (so the tenant keeps
   * read-only access) and the scheduler notifies admins to contact us.
   * Each row is wrapped in try/catch so one bad tenant does not skip
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
    });

    let failed = 0;
    for (const subscription of expiredTrials) {
      try {
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: SubscriptionStatus.PAST_DUE,
          },
        });
        this.logger.log(`Trial subscription ${subscription.id} moved to PAST_DUE`);
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
