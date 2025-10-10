import {
  Controller,
  Post,
  Body,
  Headers,
  RawBodyRequest,
  Req,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { StripeService } from '../services/stripe.service';
import { IyzicoService } from '../services/iyzico.service';
import { BillingService } from '../services/billing.service';
import { PaymentStatus, SubscriptionStatus } from '../../../common/constants/subscription.enum';

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly iyzicoService: IyzicoService,
    private readonly billingService: BillingService,
  ) {}

  /**
   * Handle Stripe webhooks
   */
  @Post('stripe')
  async handleStripeWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const payload = req.rawBody;

    if (!payload) {
      throw new BadRequestException('Missing request body');
    }

    let event: any;

    try {
      event = this.stripeService.verifyWebhookSignature(payload, signature);
    } catch (error) {
      this.logger.error(`Webhook signature verification failed: ${error.message}`);
      throw new BadRequestException('Invalid signature');
    }

    this.logger.log(`Stripe webhook received: ${event.type}`);

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handleStripePaymentSuccess(event.data.object);
          break;

        case 'payment_intent.payment_failed':
          await this.handleStripePaymentFailure(event.data.object);
          break;

        case 'customer.subscription.updated':
        case 'customer.subscription.created':
          await this.handleStripeSubscriptionUpdate(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await this.handleStripeSubscriptionDeleted(event.data.object);
          break;

        case 'invoice.payment_succeeded':
          await this.handleStripeInvoicePaymentSucceeded(event.data.object);
          break;

        case 'invoice.payment_failed':
          await this.handleStripeInvoicePaymentFailed(event.data.object);
          break;

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
      }

      return { received: true };
    } catch (error) {
      this.logger.error(`Error processing webhook: ${error.message}`);
      throw error;
    }
  }

  /**
   * Handle Iyzico callbacks
   */
  @Post('iyzico')
  async handleIyzicoWebhook(@Body() payload: any) {
    this.logger.log(`Iyzico webhook received: ${JSON.stringify(payload)}`);

    // Verify callback (basic validation)
    const isValid = this.iyzicoService.verifyCallback(payload);

    if (!isValid) {
      throw new BadRequestException('Invalid callback payload');
    }

    try {
      const result = await this.iyzicoService.handlePaymentCallback(payload);

      if (result.status === 'success') {
        await this.handleIyzicoPaymentSuccess(result);
      } else {
        await this.handleIyzicoPaymentFailure(result);
      }

      return { received: true };
    } catch (error) {
      this.logger.error(`Error processing Iyzico webhook: ${error.message}`);
      throw error;
    }
  }

  // ========================================
  // Stripe Event Handlers
  // ========================================

  private async handleStripePaymentSuccess(paymentIntent: any) {
    const subscriptionId = paymentIntent.metadata?.subscriptionId;

    if (subscriptionId) {
      await this.prisma.subscriptionPayment.updateMany({
        where: { stripePaymentIntentId: paymentIntent.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paidAt: new Date(),
        },
      });

      this.logger.log(`Payment succeeded for subscription: ${subscriptionId}`);
    }
  }

  private async handleStripePaymentFailure(paymentIntent: any) {
    const subscriptionId = paymentIntent.metadata?.subscriptionId;

    if (subscriptionId) {
      await this.prisma.subscriptionPayment.updateMany({
        where: { stripePaymentIntentId: paymentIntent.id },
        data: {
          status: PaymentStatus.FAILED,
          failureCode: paymentIntent.last_payment_error?.code,
          failureMessage: paymentIntent.last_payment_error?.message,
        },
      });

      this.logger.log(`Payment failed for subscription: ${subscriptionId}`);
    }
  }

  private async handleStripeSubscriptionUpdate(subscription: any) {
    const ourSubscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (ourSubscription) {
      const status = this.mapStripeStatus(subscription.status);

      await this.prisma.subscription.update({
        where: { id: ourSubscription.id },
        data: {
          status,
          currentPeriodStart: new Date(subscription.current_period_start * 1000),
          currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
      });

      this.logger.log(`Subscription updated: ${ourSubscription.id} -> ${status}`);
    }
  }

  private async handleStripeSubscriptionDeleted(subscription: any) {
    const ourSubscription = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (ourSubscription) {
      await this.prisma.subscription.update({
        where: { id: ourSubscription.id },
        data: {
          status: SubscriptionStatus.CANCELLED,
          endedAt: new Date(),
        },
      });

      this.logger.log(`Subscription deleted: ${ourSubscription.id}`);
    }
  }

  private async handleStripeInvoicePaymentSucceeded(invoice: any) {
    this.logger.log(`Invoice payment succeeded: ${invoice.id}`);
  }

  private async handleStripeInvoicePaymentFailed(invoice: any) {
    this.logger.log(`Invoice payment failed: ${invoice.id}`);
  }

  // ========================================
  // Iyzico Event Handlers
  // ========================================

  private async handleIyzicoPaymentSuccess(result: any) {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { iyzicoPaymentId: result.paymentId },
    });

    if (payment) {
      await this.prisma.subscriptionPayment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paidAt: new Date(),
        },
      });

      this.logger.log(`Iyzico payment succeeded: ${result.paymentId}`);
    }
  }

  private async handleIyzicoPaymentFailure(result: any) {
    this.logger.log(`Iyzico payment failed: ${result.paymentId} - ${result.errorMessage}`);
  }

  // ========================================
  // Helpers
  // ========================================

  private mapStripeStatus(stripeStatus: string): SubscriptionStatus {
    const statusMap: Record<string, SubscriptionStatus> = {
      active: SubscriptionStatus.ACTIVE,
      trialing: SubscriptionStatus.TRIALING,
      past_due: SubscriptionStatus.PAST_DUE,
      canceled: SubscriptionStatus.CANCELLED,
      unpaid: SubscriptionStatus.EXPIRED,
    };

    return statusMap[stripeStatus] || SubscriptionStatus.ACTIVE;
  }
}
