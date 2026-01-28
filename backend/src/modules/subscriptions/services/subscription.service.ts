import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BillingService } from './billing.service';
import { NotificationService } from './notification.service';
import {
  SubscriptionStatus,
  BillingCycle,
  PaymentProvider,
  PaymentStatus,
  SubscriptionPlanType,
  PaymentRegion,
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
   * Get current active subscription for a tenant
   */
  async getCurrentSubscription(tenantId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        tenantId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING],
        },
      },
      include: {
        plan: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return subscription;
  }

  /**
   * Get subscription by ID
   */
  async getSubscriptionById(id: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        plan: true,
        tenant: true,
        payments: {
          orderBy: { createdAt: 'desc' },
        },
        invoices: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    return subscription;
  }

  /**
   * Create a new subscription
   */
  async createSubscription(tenantId: string, dto: CreateSubscriptionDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // Check if admin user's email is verified
    const adminUser = await this.prisma.user.findFirst({
      where: {
        tenantId,
        role: 'ADMIN',
      },
    });

    if (!adminUser) {
      throw new NotFoundException('Admin user not found for this tenant');
    }

    if (!adminUser.emailVerified) {
      throw new BadRequestException(
        'Email must be verified before creating a subscription. ' +
        'Please check your email for the 6-digit verification code.'
      );
    }

    // Check if tenant already has an active subscription
    const existingSubscription = await this.getCurrentSubscription(tenantId);
    if (existingSubscription) {
      throw new BadRequestException('Tenant already has an active subscription');
    }

    // Get the plan
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });

    if (!plan || !plan.isActive) {
      throw new NotFoundException('Plan not found or inactive');
    }

    // Determine if trial applies
    const canUseTrial = !tenant.trialUsed && plan.trialDays > 0 && plan.name !== SubscriptionPlanType.FREE;
    const isTrialPeriod = canUseTrial;

    // Calculate dates
    const now = new Date();
    let trialStart: Date | null = null;
    let trialEnd: Date | null = null;
    let currentPeriodStart = now;
    let currentPeriodEnd: Date;

    if (isTrialPeriod) {
      trialStart = now;
      trialEnd = new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000);
      currentPeriodStart = now;
      currentPeriodEnd = trialEnd;
    } else {
      // Calculate billing period end
      if (dto.billingCycle === BillingCycle.MONTHLY) {
        currentPeriodEnd = new Date(now);
        currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
      } else {
        currentPeriodEnd = new Date(now);
        currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
      }
    }

    // Determine amount
    const amount = dto.billingCycle === BillingCycle.MONTHLY ? plan.monthlyPrice : plan.yearlyPrice;

    // Determine payment provider based on region
    // Since PayTR is removed, all subscriptions now use manual/contact-based payment
    const paymentProvider = PaymentProvider.EMAIL;

    // Create subscription in database
    const subscription = await this.prisma.subscription.create({
      data: {
        tenantId,
        planId: dto.planId,
        status: isTrialPeriod ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
        billingCycle: dto.billingCycle,
        paymentProvider,
        startDate: now,
        currentPeriodStart,
        currentPeriodEnd,
        isTrialPeriod,
        trialStart,
        trialEnd,
        amount: Number(amount),
        currency: plan.currency,
        autoRenew: true,
        cancelAtPeriodEnd: false,
      },
      include: { plan: true },
    });

    // Update tenant
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        currentPlanId: plan.id,
        trialUsed: isTrialPeriod ? true : tenant.trialUsed,
        trialStartedAt: isTrialPeriod ? trialStart : tenant.trialStartedAt,
        trialEndsAt: isTrialPeriod ? trialEnd : tenant.trialEndsAt,
      },
    });

    // Create payment provider subscription (if not free and not trial)
    if (plan.name !== SubscriptionPlanType.FREE && !isTrialPeriod) {
      await this.setupPaymentProviderSubscription(subscription.id, tenant, plan, dto, adminUser);
    }

    this.logger.log(`Subscription created for tenant ${tenantId}: ${subscription.id}`);
    return subscription;
  }

  /**
   * Setup subscription with payment provider
   * All subscriptions now use contact-based flow (WhatsApp/Email)
   */
  private async setupPaymentProviderSubscription(
    subscriptionId: string,
    tenant: any,
    plan: any,
    dto: CreateSubscriptionDto,
    adminUser: any,
  ) {
    // All payments are now handled via contact-based flow (WhatsApp/Email)
    // Admin will manually activate subscription after receiving payment
    this.logger.log(`Subscription ${subscriptionId} - contact-based payment flow initiated`);
  }

  /**
   * Change subscription plan (upgrade or downgrade)
   * - Upgrade: Returns payment info, plan changes after successful payment
   * - Downgrade: Schedules plan change for period end
   */
  async changePlan(subscriptionId: string, dto: ChangePlanDto) {
    const subscription = await this.getSubscriptionById(subscriptionId);

    const currentPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: subscription.planId },
    });

    const newPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.newPlanId },
    });

    if (!newPlan || !newPlan.isActive) {
      throw new NotFoundException('New plan not found or inactive');
    }

    if (!currentPlan) {
      throw new NotFoundException('Current plan not found');
    }

    if (subscription.planId === dto.newPlanId) {
      throw new BadRequestException('Already subscribed to this plan');
    }

    // Check if there's already a scheduled downgrade
    if (subscription.scheduledDowngradePlanId) {
      throw new BadRequestException(
        'There is already a scheduled plan change. Please cancel it first.'
      );
    }

    const billingCycle = dto.billingCycle || subscription.billingCycle;
    const newAmount = billingCycle === BillingCycle.MONTHLY ? newPlan.monthlyPrice : newPlan.yearlyPrice;
    const currentAmount = Number(subscription.amount);

    const isUpgrade = Number(newAmount) > currentAmount;

    // Calculate proration for upgrades
    const daysRemaining = this.billingService.getDaysRemaining(subscription.currentPeriodEnd);
    const totalDays = this.billingService.getTotalDaysInPeriod(
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
    );
    const prorationAmount = this.billingService.calculateProration(
      currentAmount,
      Number(newAmount),
      daysRemaining,
      totalDays,
    );

    if (isUpgrade) {
      // For upgrades, return payment info - plan will change after successful payment
      this.logger.log(`Upgrade requested: ${currentPlan.name} -> ${newPlan.name} (proration: ${prorationAmount})`);

      return {
        subscription,
        type: 'upgrade',
        requiresPayment: prorationAmount > 0,
        paymentInfo: {
          subscriptionId: subscription.id,
          newPlanId: dto.newPlanId,
          billingCycle,
          prorationAmount,
          newAmount: Number(newAmount),
          currency: newPlan.currency,
          newPlan,
        },
      };
    } else {
      // For downgrades, validate current usage against new plan limits
      const usage = await this.getCurrentUsage(subscription.tenantId);
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
          `Cannot downgrade: Current usage exceeds new plan limits. Please reduce: ${violations.join(', ')}`
        );
      }

      // Schedule downgrade for period end
      const updatedSubscription = await this.prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          scheduledDowngradePlanId: dto.newPlanId,
          scheduledDowngradeBillingCycle: billingCycle,
        },
        include: { plan: true, scheduledDowngradePlan: true },
      });

      this.logger.log(`Downgrade scheduled for ${subscription.currentPeriodEnd}: ${currentPlan.name} -> ${newPlan.name}`);

      return {
        subscription: updatedSubscription,
        type: 'downgrade',
        requiresPayment: false,
        scheduledFor: subscription.currentPeriodEnd,
        newPlan,
      };
    }
  }

  /**
   * Apply upgrade after successful payment (called by webhook)
   */
  async applyUpgrade(
    subscriptionId: string,
    newPlanId: string,
    billingCycle: string,
  ) {
    const subscription = await this.getSubscriptionById(subscriptionId);

    const newPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: newPlanId },
    });

    if (!newPlan) {
      throw new NotFoundException('New plan not found');
    }

    const newAmount = billingCycle === BillingCycle.MONTHLY ? newPlan.monthlyPrice : newPlan.yearlyPrice;

    // Apply the upgrade immediately
    const updatedSubscription = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        planId: newPlanId,
        billingCycle,
        amount: Number(newAmount),
        currency: newPlan.currency,
      },
      include: { plan: true },
    });

    // Update tenant's current plan
    await this.prisma.tenant.update({
      where: { id: subscription.tenantId },
      data: { currentPlanId: newPlanId },
    });

    // Send notification
    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId: subscription.tenantId, role: 'ADMIN' },
      select: { email: true },
    });

    if (adminUser?.email) {
      await this.notificationService.sendPlanChangeConfirmation(
        adminUser.email,
        subscription.tenant.name,
        newPlan.displayName,
      );
    }

    this.logger.log(`Upgrade applied for subscription ${subscriptionId} - ${newPlan.displayName}`);
    return updatedSubscription;
  }

  /**
   * Get current resource usage for a tenant
   */
  private async getCurrentUsage(tenantId: string) {
    const [users, tables, products, categories] = await Promise.all([
      this.prisma.user.count({ where: { tenantId } }),
      this.prisma.table.count({ where: { tenantId } }),
      this.prisma.product.count({ where: { tenantId } }),
      this.prisma.category.count({ where: { tenantId } }),
    ]);

    return { users, tables, products, categories };
  }

  /**
   * Apply scheduled downgrade (called by scheduler at period end)
   */
  async applyScheduledDowngrade(subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        tenant: true,
        scheduledDowngradePlan: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (!subscription.scheduledDowngradePlanId || !subscription.scheduledDowngradePlan) {
      throw new BadRequestException('No scheduled downgrade found');
    }

    const newPlan = subscription.scheduledDowngradePlan;
    const billingCycle = subscription.scheduledDowngradeBillingCycle || subscription.billingCycle;
    const newAmount = billingCycle === BillingCycle.MONTHLY ? newPlan.monthlyPrice : newPlan.yearlyPrice;

    // Apply the downgrade
    const updatedSubscription = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        planId: subscription.scheduledDowngradePlanId,
        billingCycle,
        amount: Number(newAmount),
        currency: newPlan.currency,
        // Clear scheduled downgrade
        scheduledDowngradePlanId: null,
        scheduledDowngradeBillingCycle: null,
      },
      include: { plan: true },
    });

    // Update tenant's current plan
    await this.prisma.tenant.update({
      where: { id: subscription.tenantId },
      data: { currentPlanId: subscription.scheduledDowngradePlanId },
    });

    // Send notification
    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId: subscription.tenantId, role: 'ADMIN' },
      select: { email: true },
    });

    if (adminUser?.email) {
      await this.notificationService.sendPlanChangeConfirmation(
        adminUser.email,
        subscription.tenant.name,
        newPlan.displayName,
      );
    }

    this.logger.log(`Scheduled downgrade applied for subscription ${subscriptionId} - ${newPlan.displayName}`);
    return updatedSubscription;
  }

  /**
   * Get scheduled downgrade for a subscription
   * Returns null if no scheduled downgrade exists
   */
  async getScheduledDowngrade(subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        scheduledDowngradePlan: true,
      },
    });

    if (!subscription || !subscription.scheduledDowngradePlanId) {
      return null;
    }

    return {
      scheduledPlanId: subscription.scheduledDowngradePlanId,
      scheduledPlan: subscription.scheduledDowngradePlan,
      scheduledBillingCycle: subscription.scheduledDowngradeBillingCycle,
      scheduledFor: subscription.currentPeriodEnd,
    };
  }

  /**
   * Cancel a scheduled downgrade
   */
  async cancelScheduledDowngrade(subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

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

    this.logger.log(`Scheduled downgrade cancelled for subscription ${subscriptionId}`);

    return { success: true, message: 'Scheduled downgrade cancelled' };
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(
    subscriptionId: string,
    immediate: boolean = false,
    reason?: string
  ) {
    const subscription = await this.getSubscriptionById(subscriptionId);

    if (subscription.status === SubscriptionStatus.CANCELLED) {
      throw new BadRequestException('Subscription already cancelled');
    }

    if (immediate) {
      // Cancel immediately
      const updated = await this.prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: new Date(),
          endedAt: new Date(),
          autoRenew: false,
          cancellationReason: reason,
        },
        include: { plan: true, tenant: true },
      });

      // PayTR uses one-time payments, no subscription to cancel

      this.logger.log(`Subscription ${subscriptionId} cancelled immediately. Reason: ${reason || 'Not provided'}`);
      return updated;
    } else {
      // Cancel at period end
      const updated = await this.prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          cancelAtPeriodEnd: true,
          autoRenew: false,
          cancelledAt: new Date(),
          cancellationReason: reason,
        },
        include: { plan: true, tenant: true },
      });

      // PayTR uses one-time payments, no subscription to cancel

      this.logger.log(`Subscription ${subscriptionId} will cancel at period end. Reason: ${reason || 'Not provided'}`);
      return updated;
    }
  }

  /**
   * Reactivate a cancelled subscription
   */
  async reactivateSubscription(subscriptionId: string) {
    const subscription = await this.getSubscriptionById(subscriptionId);

    if (subscription.status !== SubscriptionStatus.CANCELLED || !subscription.cancelAtPeriodEnd) {
      throw new BadRequestException('Can only reactivate subscriptions that are set to cancel at period end');
    }

    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        cancelAtPeriodEnd: false,
        autoRenew: true,
        cancelledAt: null,
      },
      include: { plan: true },
    });

    this.logger.log(`Subscription ${subscriptionId} reactivated`);
    return updated;
  }

  /**
   * Update subscription settings
   */
  async updateSubscription(subscriptionId: string, dto: UpdateSubscriptionDto) {
    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: dto,
      include: { plan: true },
    });

    return updated;
  }

  /**
   * Renew subscription (called by cron job)
   */
  async renewSubscription(subscriptionId: string) {
    const subscription = await this.getSubscriptionById(subscriptionId);

    if (!subscription.autoRenew) {
      this.logger.log(`Subscription ${subscriptionId} is set to not auto-renew`);
      return null;
    }

    // Calculate new period
    const now = new Date();
    const newPeriodStart = subscription.currentPeriodEnd;
    let newPeriodEnd: Date;

    if (subscription.billingCycle === BillingCycle.MONTHLY) {
      newPeriodEnd = new Date(newPeriodStart);
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
    } else {
      newPeriodEnd = new Date(newPeriodStart);
      newPeriodEnd.setFullYear(newPeriodEnd.getFullYear() + 1);
    }

    // Attempt payment
    // This would integrate with payment provider to charge the customer
    // For now, we'll just update the subscription

    const renewed = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        status: SubscriptionStatus.ACTIVE,
        isTrialPeriod: false,
      },
      include: { plan: true },
    });

    this.logger.log(`Subscription ${subscriptionId} renewed`);
    return renewed;
  }

  /**
   * Check if subscription is active
   */
  async isSubscriptionActive(tenantId: string): Promise<boolean> {
    const subscription = await this.getCurrentSubscription(tenantId);

    if (!subscription) {
      return false;
    }

    const now = new Date();
    const isActive = subscription.status === SubscriptionStatus.ACTIVE || subscription.status === SubscriptionStatus.TRIALING;
    const notExpired = subscription.currentPeriodEnd > now;

    return isActive && notExpired;
  }

  /**
   * Get all available plans
   */
  async getAvailablePlans() {
    const plans = await this.prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPrice: 'asc' },
    });

    const now = new Date();

    // Transform flat schema to nested structure expected by frontend
    return plans.map(plan => {
      // Check if discount is currently active
      const isDiscountActive = plan.isDiscountActive &&
        plan.discountPercentage &&
        plan.discountStartDate &&
        plan.discountEndDate &&
        plan.discountStartDate <= now &&
        plan.discountEndDate >= now;

      // Calculate discounted prices if discount is active
      const discountMultiplier = isDiscountActive
        ? (100 - plan.discountPercentage!) / 100
        : 1;

      const discountedMonthlyPrice = Number(plan.monthlyPrice) * discountMultiplier;
      const discountedYearlyPrice = Number(plan.yearlyPrice) * discountMultiplier;

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
        },
        // Discount information
        discount: isDiscountActive ? {
          percentage: plan.discountPercentage,
          label: plan.discountLabel,
          endDate: plan.discountEndDate?.toISOString(),
          discountedMonthlyPrice: Number(discountedMonthlyPrice.toFixed(2)),
          discountedYearlyPrice: Number(discountedYearlyPrice.toFixed(2)),
        } : null,
        isActive: plan.isActive,
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
      };
    });
  }

  /**
   * Get plan by name
   */
  async getPlanByName(name: SubscriptionPlanType) {
    return await this.prisma.subscriptionPlan.findUnique({
      where: { name },
    });
  }

  /**
   * Expire trial subscriptions (called by cron)
   */
  async expireTrials() {
    const now = new Date();

    const expiredTrials = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.TRIALING,
        isTrialPeriod: true,
        trialEnd: {
          lte: now,
        },
      },
    });

    for (const subscription of expiredTrials) {
      // Check if payment method is on file
      const hasPaymentMethod = subscription.stripeCustomerId || subscription.paytrMerchantOid;

      if (hasPaymentMethod && subscription.autoRenew) {
        // Attempt to convert to paid subscription
        await this.convertTrialToPaid(subscription.id);
      } else {
        // Expire the subscription
        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: SubscriptionStatus.EXPIRED,
            endedAt: now,
          },
        });

        this.logger.log(`Trial subscription ${subscription.id} expired`);
      }
    }

    return expiredTrials.length;
  }

  /**
   * Convert trial subscription to paid
   */
  private async convertTrialToPaid(subscriptionId: string) {
    const subscription = await this.getSubscriptionById(subscriptionId);

    // Calculate new billing period
    const newPeriodStart = new Date();
    let newPeriodEnd: Date;

    if (subscription.billingCycle === BillingCycle.MONTHLY) {
      newPeriodEnd = new Date(newPeriodStart);
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
    } else {
      newPeriodEnd = new Date(newPeriodStart);
      newPeriodEnd.setFullYear(newPeriodEnd.getFullYear() + 1);
    }

    // Update subscription
    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        isTrialPeriod: false,
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
      },
    });

    this.logger.log(`Trial subscription ${subscriptionId} converted to paid`);
  }
}
