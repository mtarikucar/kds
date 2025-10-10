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

      const result = await this.iyzicoService.createPayment(
        Number(subscription.amount),
        subscription.currency,
        customer,
        dto.iyzicoDetails,
        `SUB-${subscription.id}`,
        `Subscription payment for ${subscription.plan?.displayName}`,
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
