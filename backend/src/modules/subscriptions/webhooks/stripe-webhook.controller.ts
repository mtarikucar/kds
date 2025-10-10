import {
  Controller,
  Post,
  Headers,
  Body,
  BadRequestException,
  Logger,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { StripeService } from '../services/stripe.service';
import { BillingService } from '../services/billing.service';
import { NotificationService } from '../services/notification.service';
import {
  PaymentStatus,
  SubscriptionStatus,
  InvoiceStatus,
} from '../../../common/constants/subscription.enum';
import Stripe from 'stripe';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly billingService: BillingService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Get tenant admin email for notifications
   */
  private async getTenantAdminEmail(tenantId: string): Promise<string | null> {
    const adminUser = await this.prisma.user.findFirst({
      where: {
        tenantId,
        role: 'ADMIN',
      },
      select: { email: true },
    });
    return adminUser?.email || null;
  }

  /**
   * Handle Stripe webhook events
   * Important: This endpoint needs raw body for signature verification
   */
  @Post()
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() request: RawBodyRequest<Request>,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    let event: Stripe.Event;

    try {
      // Get raw body for signature verification
      const rawBody = request.rawBody || request.body;
      event = this.stripeService.verifyWebhookSignature(rawBody, signature);
    } catch (error) {
      this.logger.error(`Webhook signature verification failed: ${error.message}`);
      throw new BadRequestException('Invalid signature');
    }

    this.logger.log(`Processing Stripe webhook event: ${event.type}`);

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
          break;

        case 'invoice.paid':
          await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;

        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;

        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;

        case 'customer.subscription.trial_will_end':
          await this.handleTrialWillEnd(event.data.object as Stripe.Subscription);
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }

      return { received: true, eventType: event.type };
    } catch (error) {
      this.logger.error(`Error processing webhook: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle successful payment intent
   */
  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(`Payment intent succeeded: ${paymentIntent.id}`);

    // Find subscription payment by Stripe payment intent ID
    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
      include: {
        subscription: {
          include: {
            plan: true,
            tenant: true,
          },
        },
      },
    });

    if (payment) {
      // Update payment status
      await this.prisma.subscriptionPayment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paidAt: new Date(),
          paymentMethod: paymentIntent.payment_method as string,
        },
      });

      // Update related invoice
      const invoice = await this.prisma.invoice.findFirst({
        where: { paymentId: payment.id },
      });

      if (invoice) {
        await this.billingService.markInvoiceAsPaid(invoice.id, payment.id);
      }

      // Send notification
      if (payment.subscription.tenant) {
        const adminEmail = await this.getTenantAdminEmail(payment.subscription.tenantId);
        if (adminEmail) {
          await this.notificationService.sendPaymentSuccessful(
            adminEmail,
            payment.subscription.tenant.name,
            Number(payment.amount),
            payment.currency,
            invoice?.invoiceNumber || 'N/A',
          );
        }
      }
    }
  }

  /**
   * Handle failed payment intent
   */
  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
    this.logger.log(`Payment intent failed: ${paymentIntent.id}`);

    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
      include: {
        subscription: {
          include: {
            tenant: true,
          },
        },
      },
    });

    if (payment) {
      // Update payment status
      await this.prisma.subscriptionPayment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          failureCode: paymentIntent.last_payment_error?.code,
          failureMessage: paymentIntent.last_payment_error?.message,
          retryCount: { increment: 1 },
        },
      });

      // Update subscription to past_due if needed
      await this.prisma.subscription.update({
        where: { id: payment.subscriptionId },
        data: { status: SubscriptionStatus.PAST_DUE },
      });

      // Send notification
      if (payment.subscription.tenant) {
        const adminEmail = await this.getTenantAdminEmail(payment.subscription.tenantId);
        if (adminEmail) {
          await this.notificationService.sendPaymentFailed(
            adminEmail,
            payment.subscription.tenant.name,
            Number(payment.amount),
            paymentIntent.last_payment_error?.message || 'Payment failed',
          );
        }
      }
    }
  }

  /**
   * Handle invoice paid
   */
  private async handleInvoicePaid(stripeInvoice: Stripe.Invoice) {
    this.logger.log(`Invoice paid: ${stripeInvoice.id}`);

    // Find subscription by Stripe subscription ID
    const invoiceSubscription = (stripeInvoice as any).subscription;
    const subscriptionId = typeof invoiceSubscription === 'string'
      ? invoiceSubscription
      : invoiceSubscription?.id;

    if (!subscriptionId) {
      this.logger.warn(`No subscription ID found in invoice: ${stripeInvoice.id}`);
      return;
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
      include: { plan: true, tenant: true },
    });

    if (subscription) {
      // Update subscription status
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.ACTIVE },
      });

      this.logger.log(`Subscription ${subscription.id} marked as active`);
    }
  }

  /**
   * Handle invoice payment failed
   */
  private async handleInvoicePaymentFailed(stripeInvoice: Stripe.Invoice) {
    this.logger.log(`Invoice payment failed: ${stripeInvoice.id}`);

    const invoiceSubscription = (stripeInvoice as any).subscription;
    const subscriptionId = typeof invoiceSubscription === 'string'
      ? invoiceSubscription
      : invoiceSubscription?.id;

    if (!subscriptionId) {
      this.logger.warn(`No subscription ID found in invoice: ${stripeInvoice.id}`);
      return;
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (subscription) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: SubscriptionStatus.PAST_DUE },
      });
    }
  }

  /**
   * Handle subscription updated
   */
  private async handleSubscriptionUpdated(stripeSubscription: Stripe.Subscription) {
    this.logger.log(`Subscription updated: ${stripeSubscription.id}`);

    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: stripeSubscription.id },
    });

    if (subscription) {
      // Map Stripe status to our status
      const statusMap: Record<string, SubscriptionStatus> = {
        active: SubscriptionStatus.ACTIVE,
        trialing: SubscriptionStatus.TRIALING,
        past_due: SubscriptionStatus.PAST_DUE,
        canceled: SubscriptionStatus.CANCELLED,
        unpaid: SubscriptionStatus.PAST_DUE,
      };

      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: statusMap[stripeSubscription.status] || subscription.status,
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        },
      });
    }
  }

  /**
   * Handle subscription deleted (cancelled)
   */
  private async handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription) {
    this.logger.log(`Subscription deleted: ${stripeSubscription.id}`);

    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: stripeSubscription.id },
      include: { plan: true, tenant: true },
    });

    if (subscription) {
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.CANCELLED,
          endedAt: new Date(),
        },
      });

      // Send notification
      if (subscription.tenant) {
        const adminEmail = await this.getTenantAdminEmail(subscription.tenantId);
        if (adminEmail) {
          await this.notificationService.sendSubscriptionCancelled(
            adminEmail,
            subscription.tenant.name,
            subscription.plan?.displayName || 'Plan',
            new Date(),
          );
        }
      }
    }
  }

  /**
   * Handle trial ending soon
   */
  private async handleTrialWillEnd(stripeSubscription: Stripe.Subscription) {
    this.logger.log(`Trial will end: ${stripeSubscription.id}`);

    const subscription = await this.prisma.subscription.findFirst({
      where: { stripeSubscriptionId: stripeSubscription.id },
      include: { plan: true, tenant: true },
    });

    if (subscription && subscription.tenant) {
      const daysRemaining = subscription.trialEnd
        ? Math.ceil((subscription.trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : 0;

      const adminEmail = await this.getTenantAdminEmail(subscription.tenantId);
      if (adminEmail) {
        await this.notificationService.sendTrialEndingReminder(
          adminEmail,
          subscription.tenant.name,
          subscription.plan?.displayName || 'Plan',
          daysRemaining,
        );
      }
    }
  }
}
