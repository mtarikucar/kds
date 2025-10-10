import {
  Controller,
  Post,
  Body,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { IyzicoService } from '../services/iyzico.service';
import { BillingService } from '../services/billing.service';
import { NotificationService } from '../services/notification.service';
import {
  PaymentStatus,
  SubscriptionStatus,
} from '../../../common/constants/subscription.enum';

interface IyzicoCallbackPayload {
  status: string;
  paymentId: string;
  conversationId: string;
  price: string;
  paidPrice: string;
  currency: string;
  errorMessage?: string;
  errorCode?: string;
}

@Controller('webhooks/iyzico')
export class IyzicoWebhookController {
  private readonly logger = new Logger(IyzicoWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly iyzicoService: IyzicoService,
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
   * Handle Iyzico callback/webhook
   * Iyzico sends payment status updates via callback URL
   */
  @Post()
  async handleCallback(@Body() payload: IyzicoCallbackPayload) {
    this.logger.log(`Received Iyzico callback: ${JSON.stringify(payload)}`);

    // Verify callback (basic validation)
    if (!this.iyzicoService.verifyCallback(payload)) {
      throw new BadRequestException('Invalid callback payload');
    }

    try {
      if (payload.status === 'success') {
        await this.handlePaymentSuccess(payload);
      } else {
        await this.handlePaymentFailure(payload);
      }

      return { success: true, message: 'Callback processed' };
    } catch (error) {
      this.logger.error(`Error processing Iyzico callback: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Handle successful Iyzico payment
   */
  private async handlePaymentSuccess(payload: IyzicoCallbackPayload) {
    this.logger.log(`Iyzico payment succeeded: ${payload.paymentId}`);

    // Find payment by Iyzico payment ID
    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: { iyzicoPaymentId: payload.paymentId },
      include: {
        subscription: {
          include: {
            plan: true,
            tenant: true,
          },
        },
      },
    });

    if (!payment) {
      this.logger.warn(`Payment not found for Iyzico payment ID: ${payload.paymentId}`);
      return;
    }

    // Update payment status
    await this.prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCEEDED,
        paidAt: new Date(),
      },
    });

    // Update subscription to active
    await this.prisma.subscription.update({
      where: { id: payment.subscriptionId },
      data: { status: SubscriptionStatus.ACTIVE },
    });

    // Update related invoice
    const invoice = await this.prisma.invoice.findFirst({
      where: { paymentId: payment.id },
    });

    if (invoice) {
      await this.billingService.markInvoiceAsPaid(invoice.id, payment.id);
    }

    // Send success notification
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

        // If subscription was in trial, send activation email
        if (payment.subscription.isTrialPeriod) {
          await this.notificationService.sendSubscriptionActivated(
            adminEmail,
            payment.subscription.tenant.name,
            payment.subscription.plan?.displayName || 'Plan',
            payment.subscription.billingCycle,
          );
        }
      }
    }

    this.logger.log(`Iyzico payment processed successfully: ${payment.id}`);
  }

  /**
   * Handle failed Iyzico payment
   */
  private async handlePaymentFailure(payload: IyzicoCallbackPayload) {
    this.logger.log(`Iyzico payment failed: ${payload.paymentId}`);

    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: { iyzicoPaymentId: payload.paymentId },
      include: {
        subscription: {
          include: {
            tenant: true,
          },
        },
      },
    });

    if (!payment) {
      this.logger.warn(`Payment not found for Iyzico payment ID: ${payload.paymentId}`);
      return;
    }

    // Update payment status
    await this.prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failureCode: payload.errorCode,
        failureMessage: payload.errorMessage,
        retryCount: { increment: 1 },
      },
    });

    // Update subscription to past_due
    await this.prisma.subscription.update({
      where: { id: payment.subscriptionId },
      data: { status: SubscriptionStatus.PAST_DUE },
    });

    // Send failure notification
    if (payment.subscription.tenant) {
      const adminEmail = await this.getTenantAdminEmail(payment.subscription.tenantId);
      if (adminEmail) {
        await this.notificationService.sendPaymentFailed(
          adminEmail,
          payment.subscription.tenant.name,
          Number(payment.amount),
          payload.errorMessage || 'Payment failed',
        );
      }
    }

    this.logger.log(`Iyzico payment failure processed: ${payment.id}`);
  }

  /**
   * Handle payment status check (manual verification)
   */
  @Post('verify')
  async verifyPayment(@Body() body: { paymentId: string; conversationId: string }) {
    this.logger.log(`Verifying Iyzico payment: ${body.paymentId}`);

    try {
      // Retrieve payment details from Iyzico
      const result = await this.iyzicoService.getPayment(body.paymentId, body.conversationId);

      // Process based on actual status
      if (result.status === 'success') {
        await this.handlePaymentSuccess({
          status: result.status,
          paymentId: body.paymentId,
          conversationId: body.conversationId,
          price: result.price,
          paidPrice: result.paidPrice,
          currency: result.currency,
        });
      }

      return { success: true, paymentStatus: result.status };
    } catch (error) {
      this.logger.error(`Error verifying Iyzico payment: ${error.message}`);
      throw new BadRequestException('Failed to verify payment');
    }
  }
}
