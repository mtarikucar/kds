import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentProviderFactory } from './payment-provider.factory';
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
    private paymentProviderFactory: PaymentProviderFactory,
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

    // Get payment provider based on region
    const paymentProvider = this.paymentProviderFactory.getProviderType(tenant.paymentRegion as PaymentRegion);

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
   */
  private async setupPaymentProviderSubscription(
    subscriptionId: string,
    tenant: any,
    plan: any,
    dto: CreateSubscriptionDto,
    adminUser: any,
  ) {
    if (tenant.paymentRegion === PaymentRegion.TURKEY) {
      // For PayTR, we don't create subscription upfront
      // Payment will be handled when user provides card details via iframe
      this.logger.log('PayTR subscription setup deferred to payment confirmation');
    } else {
      // For international customers, payment is handled via email-based flow
      // Admin will manually activate subscription after receiving payment
      this.logger.log('International subscription - email-based payment flow');
    }
  }

  /**
   * Change subscription plan (upgrade or downgrade)
   * Creates a pending plan change that requires payment for upgrades
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

    // Check if there's already a pending plan change
    const existingPendingChange = await this.prisma.pendingPlanChange.findFirst({
      where: {
        subscriptionId,
        paymentStatus: 'PENDING',
      },
    });

    if (existingPendingChange) {
      throw new BadRequestException('There is already a pending plan change. Please complete or cancel it first.');
    }

    const billingCycle = dto.billingCycle || subscription.billingCycle;
    const newAmount = billingCycle === BillingCycle.MONTHLY ? newPlan.monthlyPrice : newPlan.yearlyPrice;
    const currentAmount = Number(subscription.amount);

    const isUpgrade = Number(newAmount) > currentAmount;

    // Calculate proration
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
      // For upgrades, create pending plan change that requires payment
      const pendingChange = await this.prisma.pendingPlanChange.create({
        data: {
          subscriptionId,
          currentPlanId: subscription.planId,
          newPlanId: dto.newPlanId,
          newBillingCycle: billingCycle,
          isUpgrade: true,
          currentAmount: currentAmount,
          newAmount: Number(newAmount),
          prorationAmount: prorationAmount,
          currency: newPlan.currency,
          paymentRequired: prorationAmount > 0,
          paymentStatus: 'PENDING',
          paymentProvider: subscription.paymentProvider,
        },
        include: {
          currentPlan: true,
          newPlan: true,
        },
      });

      this.logger.log(`Pending plan change created: ${pendingChange.id} (proration: ${prorationAmount})`);

      // Return the pending change info so frontend knows to redirect to payment
      return {
        subscription,
        pendingChange: {
          id: pendingChange.id,
          requiresPayment: prorationAmount > 0,
          prorationAmount: prorationAmount,
          currency: newPlan.currency,
          newPlan: newPlan,
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

      // Create pending downgrade scheduled for period end (no payment required)
      const pendingChange = await this.prisma.pendingPlanChange.create({
        data: {
          subscriptionId,
          currentPlanId: subscription.planId,
          newPlanId: dto.newPlanId,
          newBillingCycle: billingCycle,
          isUpgrade: false,
          currentAmount: currentAmount,
          newAmount: Number(newAmount),
          prorationAmount: 0,
          currency: newPlan.currency,
          paymentRequired: false,
          paymentStatus: 'COMPLETED', // No payment needed
          scheduledFor: subscription.currentPeriodEnd,
        },
        include: {
          currentPlan: true,
          newPlan: true,
        },
      });

      this.logger.log(`Downgrade scheduled for ${subscription.currentPeriodEnd}: ${pendingChange.id}`);

      return {
        subscription,
        pendingChange: {
          id: pendingChange.id,
          requiresPayment: false,
          scheduledFor: subscription.currentPeriodEnd,
          newPlan: newPlan,
        },
      };
    }
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
   * Apply a pending plan change after payment is confirmed
   */
  async applyPlanChange(pendingChangeId: string) {
    const pendingChange = await this.prisma.pendingPlanChange.findUnique({
      where: { id: pendingChangeId },
      include: {
        subscription: { include: { plan: true, tenant: true } },
        newPlan: true,
      },
    });

    if (!pendingChange) {
      throw new NotFoundException('Pending plan change not found');
    }

    if (pendingChange.paymentStatus !== 'COMPLETED') {
      throw new BadRequestException('Payment not completed for this plan change');
    }

    if (pendingChange.appliedAt) {
      throw new BadRequestException('Plan change already applied');
    }

    const { subscription, newPlan } = pendingChange;

    // Apply the plan change
    const updatedSubscription = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planId: pendingChange.newPlanId,
        billingCycle: pendingChange.newBillingCycle,
        amount: pendingChange.newAmount,
        currency: pendingChange.currency,
      },
      include: { plan: true },
    });

    // Update tenant's current plan
    await this.prisma.tenant.update({
      where: { id: subscription.tenantId },
      data: { currentPlanId: pendingChange.newPlanId },
    });

    // Mark pending change as applied
    await this.prisma.pendingPlanChange.update({
      where: { id: pendingChangeId },
      data: {
        appliedAt: new Date(),
      },
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

    this.logger.log(`Plan change applied for subscription ${subscription.id} - ${newPlan.displayName}`);
    return updatedSubscription;
  }

  /**
   * Cancel a pending plan change
   */
  async cancelPendingPlanChange(subscriptionId: string) {
    const pendingChange = await this.prisma.pendingPlanChange.findFirst({
      where: {
        subscriptionId,
        paymentStatus: 'PENDING',
      },
    });

    if (!pendingChange) {
      throw new NotFoundException('No pending plan change found');
    }

    await this.prisma.pendingPlanChange.delete({
      where: { id: pendingChange.id },
    });

    this.logger.log(`Pending plan change ${pendingChange.id} cancelled for subscription ${subscriptionId}`);

    return { success: true, message: 'Pending plan change cancelled' };
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
