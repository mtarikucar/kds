import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentProviderFactory } from '../services/payment-provider.factory';
import { StripeService } from '../services/stripe.service';
import { PaytrService } from '../services/paytr.service';
import { BillingService } from '../services/billing.service';
import { CreatePaymentIntentDto, ConfirmPaymentDto } from '../dto/payment-intent.dto';
import { PaymentProvider, PaymentStatus, PaymentRegion, BillingCycle } from '../../../common/constants/subscription.enum';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentProviderFactory: PaymentProviderFactory,
    private readonly stripeService: StripeService,
    private readonly paytrService: PaytrService,
    private readonly billingService: BillingService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a payment intent for subscription payment
   */
  @Post('create-intent')
  async createPaymentIntent(@Request() req, @Body() dto: CreatePaymentIntentDto) {
    const tenantId = req.user.tenantId;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new BadRequestException('Tenant not found');
    }

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
    });

    if (!plan) {
      throw new BadRequestException('Plan not found');
    }

    const amount = dto.billingCycle === 'MONTHLY' ? plan.monthlyPrice : plan.yearlyPrice;

    // Determine payment provider based on tenant's payment region
    const paymentRegion = tenant.paymentRegion as PaymentRegion || PaymentRegion.TURKEY;
    const paymentProvider = this.paymentProviderFactory.getProviderType(paymentRegion);

    // Get or create subscription
    let subscription = await this.prisma.subscription.findFirst({
      where: { tenantId, status: { in: ['ACTIVE', 'TRIALING', 'PENDING'] } },
    });

    if (!subscription) {
      subscription = await this.prisma.subscription.create({
        data: {
          tenantId,
          planId: dto.planId,
          status: 'PENDING',
          billingCycle: dto.billingCycle,
          paymentProvider: paymentProvider,
          amount: Number(amount),
          currency: plan.currency,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(), // Will be updated on payment success
        },
      });
    }

    if (paymentProvider === PaymentProvider.STRIPE) {
      // Create or get Stripe customer
      let customerId: string;

      const existingSubscription = await this.prisma.subscription.findFirst({
        where: { tenantId, stripeCustomerId: { not: null } },
      });

      if (existingSubscription?.stripeCustomerId) {
        customerId = existingSubscription.stripeCustomerId;
      } else {
        const customer = await this.stripeService.createCustomer(
          tenant.name,
          tenant.name,
          { tenantId },
        );
        customerId = customer.id;
      }

      const paymentIntent = await this.stripeService.createPaymentIntent(
        Number(amount),
        plan.currency,
        customerId,
        { planId: dto.planId, billingCycle: dto.billingCycle },
      );

      return {
        provider: PaymentProvider.STRIPE,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: Number(amount),
        currency: plan.currency,
      };
    } else {
      // PayTR Link API flow
      const frontendUrl = this.configService.get<string>('FRONTEND_URL');
      const backendUrl = this.configService.get<string>('BACKEND_URL');
      const merchantOid = `SUB-${subscription.id}-${Date.now()}`;

      const adminUser = await this.prisma.user.findFirst({
        where: { tenantId, role: 'ADMIN' },
      });

      const paymentLinkResult = await this.paytrService.createPaymentLink({
        merchantOid,
        email: adminUser?.email || req.user.email,
        amount: Number(amount),
        userName: tenant.name,
        userPhone: adminUser?.phone || '',
        description: `${plan.displayName} - ${dto.billingCycle === 'MONTHLY' ? 'Aylik' : 'Yillik'}`,
        successUrl: `${frontendUrl}/subscription/payment/success?oid=${merchantOid}`,
        failUrl: `${frontendUrl}/subscription/payment/failed?oid=${merchantOid}`,
        maxInstallment: 1,
        expiryDuration: 30,
      });

      if (paymentLinkResult.status !== 'success') {
        throw new BadRequestException(paymentLinkResult.reason || 'Failed to create payment link');
      }

      // Create pending payment record
      await this.prisma.subscriptionPayment.create({
        data: {
          subscriptionId: subscription.id,
          amount: Number(amount),
          currency: plan.currency,
          status: PaymentStatus.PENDING,
          paymentProvider: PaymentProvider.PAYTR,
          paytrMerchantOid: merchantOid,
        },
      });

      // Update subscription with PayTR info
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          planId: dto.planId,
          billingCycle: dto.billingCycle,
          amount: Number(amount),
          currency: plan.currency,
        },
      });

      return {
        provider: PaymentProvider.PAYTR,
        paymentLink: paymentLinkResult.link,
        merchantOid,
        amount: Number(amount),
        currency: plan.currency,
      };
    }
  }

  /**
   * Confirm payment with card details (for Stripe only)
   * PayTR uses redirect flow and webhook for confirmation
   */
  @Post('confirm-payment')
  async confirmPayment(@Request() req, @Body() dto: ConfirmPaymentDto) {
    const tenantId = req.user.tenantId;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
    });

    if (!tenant) {
      throw new BadRequestException('Tenant not found');
    }

    const subscription = tenant.subscriptions[0];

    if (!subscription) {
      throw new BadRequestException('No subscription found');
    }

    // Only for Stripe - PayTR uses webhook
    if (subscription.paymentProvider !== PaymentProvider.STRIPE) {
      throw new BadRequestException('PayTR payments are confirmed via redirect. Please use the payment link.');
    }

    if (!dto.paymentMethodId) {
      throw new BadRequestException('Payment method ID required for Stripe');
    }

    const confirmedPayment = await this.stripeService.confirmPaymentIntent(
      dto.paymentIntentId,
      dto.paymentMethodId,
    );

    // Calculate period dates
    const now = new Date();
    let periodEnd: Date;
    if (subscription.billingCycle === BillingCycle.MONTHLY) {
      periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else {
      periodEnd = new Date(now);
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }

    // Create payment record
    const payment = await this.prisma.subscriptionPayment.create({
      data: {
        subscriptionId: subscription.id,
        amount: Number(subscription.amount),
        currency: subscription.currency,
        status: PaymentStatus.SUCCEEDED,
        paymentProvider: PaymentProvider.STRIPE,
        stripePaymentIntentId: confirmedPayment.id,
        paidAt: new Date(),
      },
    });

    // Update subscription
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    });

    // Update tenant's current plan
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { currentPlanId: subscription.planId },
    });

    // Create invoice
    await this.billingService.createInvoice(
      subscription.id,
      payment.id,
      Number(subscription.amount),
      subscription.currency,
      now,
      periodEnd,
    );

    return { success: true, payment };
  }

  /**
   * Create payment intent for plan change
   */
  @Post('create-plan-change-intent')
  async createPlanChangeIntent(@Request() req, @Body() dto: { pendingChangeId: string }) {
    const tenantId = req.user.tenantId;

    const pendingChange = await this.prisma.pendingPlanChange.findUnique({
      where: { id: dto.pendingChangeId },
      include: {
        subscription: { include: { tenant: true } },
        newPlan: true,
      },
    });

    if (!pendingChange) {
      throw new BadRequestException('Pending plan change not found');
    }

    if (pendingChange.subscription.tenantId !== tenantId) {
      throw new BadRequestException('Unauthorized');
    }

    if (pendingChange.paymentStatus !== 'PENDING') {
      throw new BadRequestException('Payment already processed');
    }

    if (!pendingChange.paymentRequired || Number(pendingChange.prorationAmount) <= 0) {
      throw new BadRequestException('No payment required for this plan change');
    }

    const tenant = pendingChange.subscription.tenant;
    const amount = Number(pendingChange.prorationAmount);

    if (pendingChange.paymentProvider === PaymentProvider.STRIPE) {
      // Create or get Stripe customer
      let customerId: string;

      if (pendingChange.subscription.stripeCustomerId) {
        customerId = pendingChange.subscription.stripeCustomerId;
      } else {
        const customer = await this.stripeService.createCustomer(
          tenant.name,
          tenant.name,
          { tenantId: tenant.id },
        );
        customerId = customer.id;

        // Update subscription with customer ID
        await this.prisma.subscription.update({
          where: { id: pendingChange.subscriptionId },
          data: { stripeCustomerId: customerId },
        });
      }

      const paymentIntent = await this.stripeService.createPaymentIntent(
        amount,
        pendingChange.currency,
        customerId,
        { pendingChangeId: dto.pendingChangeId, type: 'plan_change' },
      );

      // Update pending change with payment intent ID
      await this.prisma.pendingPlanChange.update({
        where: { id: dto.pendingChangeId },
        data: { paymentIntentId: paymentIntent.id },
      });

      return {
        provider: PaymentProvider.STRIPE,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount,
        currency: pendingChange.currency,
      };
    } else {
      // PayTR Link API flow for plan change
      const frontendUrl = this.configService.get<string>('FRONTEND_URL');
      const merchantOid = `PLAN-${dto.pendingChangeId}-${Date.now()}`;

      const adminUser = await this.prisma.user.findFirst({
        where: { tenantId, role: 'ADMIN' },
      });

      const paymentLinkResult = await this.paytrService.createPaymentLink({
        merchantOid,
        email: adminUser?.email || req.user.email,
        amount,
        userName: tenant.name,
        userPhone: adminUser?.phone || '',
        description: `Plan Degisikligi: ${pendingChange.newPlan.displayName}`,
        successUrl: `${frontendUrl}/subscription/payment/success?oid=${merchantOid}&type=plan_change`,
        failUrl: `${frontendUrl}/subscription/payment/failed?oid=${merchantOid}&type=plan_change`,
        maxInstallment: 1,
        expiryDuration: 30,
      });

      if (paymentLinkResult.status !== 'success') {
        throw new BadRequestException(paymentLinkResult.reason || 'Failed to create payment link');
      }

      // Create pending payment record
      await this.prisma.subscriptionPayment.create({
        data: {
          subscriptionId: pendingChange.subscriptionId,
          amount: pendingChange.prorationAmount,
          currency: pendingChange.currency,
          status: PaymentStatus.PENDING,
          paymentProvider: PaymentProvider.PAYTR,
          paytrMerchantOid: merchantOid,
        },
      });

      // Update pending change with PayTR info
      await this.prisma.pendingPlanChange.update({
        where: { id: dto.pendingChangeId },
        data: { paymentIntentId: merchantOid },
      });

      return {
        provider: PaymentProvider.PAYTR,
        paymentLink: paymentLinkResult.link,
        merchantOid,
        amount,
        currency: pendingChange.currency,
      };
    }
  }

  /**
   * Confirm plan change payment (for Stripe only)
   * PayTR uses redirect flow and webhook for confirmation
   */
  @Post('confirm-plan-change-payment')
  async confirmPlanChangePayment(@Request() req, @Body() dto: {
    pendingChangeId: string;
    paymentIntentId?: string;
    paymentMethodId?: string;
  }) {
    const tenantId = req.user.tenantId;

    const pendingChange = await this.prisma.pendingPlanChange.findUnique({
      where: { id: dto.pendingChangeId },
      include: {
        subscription: { include: { tenant: true, plan: true } },
        newPlan: true,
      },
    });

    if (!pendingChange) {
      throw new BadRequestException('Pending plan change not found');
    }

    if (pendingChange.subscription.tenantId !== tenantId) {
      throw new BadRequestException('Unauthorized');
    }

    // Only for Stripe - PayTR uses webhook
    if (pendingChange.paymentProvider !== PaymentProvider.STRIPE) {
      throw new BadRequestException('PayTR payments are confirmed via redirect. Please use the payment link.');
    }

    const { subscription } = pendingChange;

    if (!dto.paymentMethodId || !dto.paymentIntentId) {
      throw new BadRequestException('Payment method ID and payment intent ID required');
    }

    const confirmedPayment = await this.stripeService.confirmPaymentIntent(
      dto.paymentIntentId,
      dto.paymentMethodId,
    );

    // Create payment record
    const payment = await this.prisma.subscriptionPayment.create({
      data: {
        subscriptionId: subscription.id,
        amount: pendingChange.prorationAmount,
        currency: pendingChange.currency,
        status: PaymentStatus.SUCCEEDED,
        paymentProvider: PaymentProvider.STRIPE,
        stripePaymentIntentId: confirmedPayment.id,
        paidAt: new Date(),
      },
    });

    // Mark pending change as completed
    await this.prisma.pendingPlanChange.update({
      where: { id: dto.pendingChangeId },
      data: {
        paymentStatus: 'COMPLETED',
      },
    });

    // Create invoice
    await this.billingService.createInvoice(
      subscription.id,
      payment.id,
      Number(pendingChange.prorationAmount),
      pendingChange.currency,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd,
    );

    return { success: true, payment, pendingChangeId: dto.pendingChangeId };
  }

  /**
   * Get payment history for tenant
   */
  @Post('history')
  async getPaymentHistory(@Request() req) {
    const tenantId = req.user.tenantId;

    const payments = await this.prisma.subscriptionPayment.findMany({
      where: {
        subscription: { tenantId },
      },
      include: {
        subscription: {
          include: { plan: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return payments;
  }
}
