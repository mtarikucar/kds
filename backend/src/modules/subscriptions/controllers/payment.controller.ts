import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentProviderFactory } from '../services/payment-provider.factory';
import { StripeService } from '../services/stripe.service';
import { IyzicoService } from '../services/iyzico.service';
import { BillingService } from '../services/billing.service';
import { CreatePaymentIntentDto, ConfirmPaymentDto } from '../dto/payment-intent.dto';
import { PaymentProvider, PaymentStatus, PaymentRegion } from '../../../common/constants/subscription.enum';
import { getProductionSafeIp } from '../../../common/utils/ip-detection.util';

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentProviderFactory: PaymentProviderFactory,
    private readonly stripeService: StripeService,
    private readonly iyzicoService: IyzicoService,
    private readonly billingService: BillingService,
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

    if (dto.paymentProvider === PaymentProvider.STRIPE) {
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
      // For Iyzico, return setup information
      // Actual payment will be made in confirm-payment
      return {
        provider: PaymentProvider.IYZICO,
        amount: Number(amount),
        currency: plan.currency,
        planId: dto.planId,
        billingCycle: dto.billingCycle,
      };
    }
  }

  /**
   * Confirm payment with card details
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

    if (subscription.paymentProvider === PaymentProvider.STRIPE) {
      // Confirm Stripe payment
      if (!dto.paymentMethodId) {
        throw new BadRequestException('Payment method ID required for Stripe');
      }

      const confirmedPayment = await this.stripeService.confirmPaymentIntent(
        dto.paymentIntentId,
        dto.paymentMethodId,
      );

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

      // Create invoice
      await this.billingService.createInvoice(
        subscription.id,
        payment.id,
        Number(subscription.amount),
        subscription.currency,
        subscription.currentPeriodStart,
        subscription.currentPeriodEnd,
      );

      return { success: true, payment };
    } else {
      // Process Iyzico payment
      if (!dto.iyzicoDetails) {
        throw new BadRequestException('Iyzico payment details required');
      }

      const customer = this.iyzicoService.formatCustomerData(
        tenantId,
        req.user.email,
        tenant.name,
      );

      // Get client IP for fraud detection
      const clientIp = getProductionSafeIp(req);

      const result = await this.iyzicoService.createPayment(
        Number(subscription.amount),
        subscription.currency,
        customer,
        dto.iyzicoDetails,
        `SUB-${subscription.id}`,
        `Subscription payment for ${subscription.plan?.displayName}`,
        clientIp,
      );

      if (result.status !== 'success') {
        throw new BadRequestException(result.errorMessage || 'Payment failed');
      }

      // Create payment record
      const payment = await this.prisma.subscriptionPayment.create({
        data: {
          subscriptionId: subscription.id,
          amount: Number(subscription.amount),
          currency: subscription.currency,
          status: PaymentStatus.SUCCEEDED,
          paymentProvider: PaymentProvider.IYZICO,
          iyzicoPaymentId: result.paymentId,
          paidAt: new Date(),
        },
      });

      // Create invoice
      await this.billingService.createInvoice(
        subscription.id,
        payment.id,
        Number(subscription.amount),
        subscription.currency,
        subscription.currentPeriodStart,
        subscription.currentPeriodEnd,
      );

      return { success: true, payment };
    }
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
      // For Iyzico, return setup information
      return {
        provider: PaymentProvider.IYZICO,
        amount,
        currency: pendingChange.currency,
        pendingChangeId: dto.pendingChangeId,
      };
    }
  }

  /**
   * Confirm plan change payment
   */
  @Post('confirm-plan-change-payment')
  async confirmPlanChangePayment(@Request() req, @Body() dto: {
    pendingChangeId: string;
    paymentIntentId?: string;
    paymentMethodId?: string;
    iyzicoDetails?: any;
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

    const { subscription } = pendingChange;

    if (pendingChange.paymentProvider === PaymentProvider.STRIPE) {
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
    } else {
      // Process Iyzico payment
      if (!dto.iyzicoDetails) {
        throw new BadRequestException('Iyzico payment details required');
      }

      const customer = this.iyzicoService.formatCustomerData(
        tenantId,
        req.user.email,
        subscription.tenant.name,
      );

      // Get client IP for fraud detection
      const clientIp = getProductionSafeIp(req);

      const result = await this.iyzicoService.createPayment(
        Number(pendingChange.prorationAmount),
        pendingChange.currency,
        customer,
        dto.iyzicoDetails,
        `PLAN-CHANGE-${dto.pendingChangeId}`,
        `Plan change to ${pendingChange.newPlan.displayName}`,
        clientIp,
      );

      if (result.status !== 'success') {
        throw new BadRequestException(result.errorMessage || 'Payment failed');
      }

      // Create payment record
      const payment = await this.prisma.subscriptionPayment.create({
        data: {
          subscriptionId: subscription.id,
          amount: pendingChange.prorationAmount,
          currency: pendingChange.currency,
          status: PaymentStatus.SUCCEEDED,
          paymentProvider: PaymentProvider.IYZICO,
          iyzicoPaymentId: result.paymentId,
          paidAt: new Date(),
        },
      });

      // Mark pending change as completed
      await this.prisma.pendingPlanChange.update({
        where: { id: dto.pendingChangeId },
        data: {
          paymentStatus: 'COMPLETED',
          paymentIntentId: result.paymentId,
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
