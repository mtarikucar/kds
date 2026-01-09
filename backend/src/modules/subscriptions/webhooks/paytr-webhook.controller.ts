import {
  Controller,
  Post,
  Body,
  Logger,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaytrService, PaytrCallbackPayload } from '../services/paytr.service';
import { BillingService } from '../services/billing.service';
import { NotificationService } from '../services/notification.service';
import { SubscriptionService } from '../services/subscription.service';
import {
  PaymentStatus,
  SubscriptionStatus,
  BillingCycle,
  SubscriptionPlanType,
} from '../../../common/constants/subscription.enum';

@Controller('webhooks/paytr')
export class PaytrWebhookController {
  private readonly logger = new Logger(PaytrWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paytrService: PaytrService,
    private readonly billingService: BillingService,
    private readonly notificationService: NotificationService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  /**
   * Handle PayTR callback
   * PayTR sends POST request with payment status
   * Must respond with "OK" for success
   */
  @Post()
  async handleCallback(@Body() payload: PaytrCallbackPayload, @Res() res: Response) {
    this.logger.log(`Received PayTR callback for order: ${payload.merchant_oid}`);

    // Verify hash
    if (!this.paytrService.verifyCallback(payload)) {
      this.logger.error('PayTR callback hash verification failed');
      return res.send('FAIL');
    }

    try {
      if (payload.status === 'success') {
        await this.handlePaymentSuccess(payload);
      } else {
        await this.handlePaymentFailure(payload);
      }

      // PayTR requires "OK" response for successful processing
      return res.send('OK');
    } catch (error) {
      this.logger.error(`Error processing PayTR callback: ${error.message}`, error.stack);
      return res.send('FAIL');
    }
  }

  /**
   * Handle successful PayTR payment
   */
  private async handlePaymentSuccess(payload: PaytrCallbackPayload) {
    this.logger.log(`PayTR payment succeeded: ${payload.merchant_oid}`);

    // Check if this is a plan change payment (PLAN-{pendingChangeId}-{timestamp})
    if (payload.merchant_oid.startsWith('PLAN-')) {
      await this.handlePlanChangePaymentSuccess(payload);
      return;
    }

    // Otherwise, it's a new subscription payment (SUB-{subscriptionId}-{timestamp})
    // Find payment by merchant_oid
    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: { paytrMerchantOid: payload.merchant_oid },
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
      this.logger.warn(`Payment not found for merchant_oid: ${payload.merchant_oid}`);
      return;
    }

    // Update payment status
    await this.prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCEEDED,
        paidAt: new Date(),
        paytrPaymentToken: payload.merchant_oid,
      },
    });

    // Calculate new period
    const now = new Date();
    const billingCycle = payment.subscription.billingCycle;
    let periodEnd: Date;

    if (billingCycle === BillingCycle.MONTHLY) {
      periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else {
      periodEnd = new Date(now);
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }

    // Activate subscription
    await this.prisma.subscription.update({
      where: { id: payment.subscriptionId },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        paytrMerchantOid: payload.merchant_oid,
        isTrialPeriod: false,
        renewalLinkSentAt: null, // Reset renewal tracking
        renewalLinkToken: null,
        graceEndDate: null,
      },
    });

    // Update tenant's current plan
    await this.prisma.tenant.update({
      where: { id: payment.subscription.tenantId },
      data: { currentPlanId: payment.subscription.planId },
    });

    // Create invoice
    const invoice = await this.billingService.createInvoice(
      payment.subscriptionId,
      payment.id,
      Number(payment.amount),
      payment.currency,
      now,
      periodEnd,
      `${payment.subscription.plan?.displayName || 'Plan'} - ${billingCycle === BillingCycle.MONTHLY ? 'Aylik' : 'Yillik'}`,
    );

    // Send success notification
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

    this.logger.log(`Subscription ${payment.subscriptionId} activated successfully`);
  }

  /**
   * Handle failed PayTR payment
   */
  private async handlePaymentFailure(payload: PaytrCallbackPayload) {
    this.logger.log(`PayTR payment failed: ${payload.merchant_oid}`);

    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: { paytrMerchantOid: payload.merchant_oid },
      include: {
        subscription: {
          include: {
            tenant: true,
          },
        },
      },
    });

    if (!payment) {
      this.logger.warn(`Payment not found for merchant_oid: ${payload.merchant_oid}`);
      return;
    }

    // Update payment status
    await this.prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        failureCode: payload.failed_reason_code,
        failureMessage: payload.failed_reason_msg,
        retryCount: { increment: 1 },
      },
    });

    // If this is a plan change payment, also update PendingPlanChange
    if (payload.merchant_oid.startsWith('PLAN-')) {
      const parts = payload.merchant_oid.split('-');
      if (parts.length >= 2) {
        const pendingChangeId = parts[1];
        await this.prisma.pendingPlanChange.update({
          where: { id: pendingChangeId },
          data: {
            paymentStatus: 'FAILED',
            failureReason: payload.failed_reason_msg || 'Payment failed',
          },
        }).catch(err => {
          this.logger.warn(`Failed to update pending plan change ${pendingChangeId}: ${err.message}`);
        });
      }
    }

    // Send failure notification
    const adminEmail = await this.getTenantAdminEmail(payment.subscription.tenantId);
    if (adminEmail) {
      await this.notificationService.sendPaymentFailed(
        adminEmail,
        payment.subscription.tenant.name,
        Number(payment.amount),
        payload.failed_reason_msg || 'Odeme basarisiz oldu',
      );
    }

    this.logger.log(`PayTR payment failure processed: ${payment.id}`);
  }

  /**
   * Handle successful plan change payment
   * Format: PLAN-{pendingChangeId}-{timestamp}
   */
  private async handlePlanChangePaymentSuccess(payload: PaytrCallbackPayload) {
    this.logger.log(`Plan change payment succeeded: ${payload.merchant_oid}`);

    // Extract pendingChangeId from merchant_oid format: PLAN-{id}-{timestamp}
    const parts = payload.merchant_oid.split('-');
    if (parts.length < 2) {
      this.logger.error(`Invalid plan change merchant_oid format: ${payload.merchant_oid}`);
      return;
    }
    const pendingChangeId = parts[1];

    // Find and update payment
    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: { paytrMerchantOid: payload.merchant_oid },
      include: {
        subscription: {
          include: { tenant: true },
        },
      },
    });

    if (payment) {
      await this.prisma.subscriptionPayment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          paidAt: new Date(),
          paytrPaymentToken: payload.merchant_oid,
        },
      });
    }

    // Update PendingPlanChange to COMPLETED
    const pendingChange = await this.prisma.pendingPlanChange.findUnique({
      where: { id: pendingChangeId },
      include: {
        subscription: { include: { tenant: true } },
        newPlan: true,
      },
    });

    if (!pendingChange) {
      this.logger.error(`Pending plan change not found: ${pendingChangeId}`);
      return;
    }

    await this.prisma.pendingPlanChange.update({
      where: { id: pendingChangeId },
      data: { paymentStatus: 'COMPLETED' },
    });

    // Apply the plan change
    try {
      await this.subscriptionService.applyPlanChange(pendingChangeId);
      this.logger.log(`Plan change applied successfully: ${pendingChangeId}`);

      // Send success notification
      const adminEmail = await this.getTenantAdminEmail(pendingChange.subscription.tenantId);
      if (adminEmail) {
        await this.notificationService.sendPaymentSuccessful(
          adminEmail,
          pendingChange.subscription.tenant.name,
          Number(pendingChange.prorationAmount),
          pendingChange.currency,
          `Plan change to ${pendingChange.newPlan.displayName}`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to apply plan change: ${error.message}`, error.stack);
      // Mark as failed if applyPlanChange throws
      await this.prisma.pendingPlanChange.update({
        where: { id: pendingChangeId },
        data: {
          paymentStatus: 'FAILED',
          failureReason: `Failed to apply: ${error.message}`,
        },
      });
    }
  }

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
}
