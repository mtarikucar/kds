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

    // Check if this is an upgrade payment (UPGRADE-{subscriptionId}-{newPlanId}-{billingCycle}-{timestamp})
    if (payload.merchant_oid.startsWith('UPGRADE-')) {
      await this.handleUpgradePaymentSuccess(payload);
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
   * Handle successful upgrade payment
   * Format: UPGRADE-{subscriptionId}-{newPlanId}-{billingCycle}-{timestamp}
   */
  private async handleUpgradePaymentSuccess(payload: PaytrCallbackPayload) {
    this.logger.log(`Upgrade payment succeeded: ${payload.merchant_oid}`);

    // Extract data from merchant_oid format: UPGRADE-{subscriptionId}-{newPlanId}-{billingCycle}-{timestamp}
    const parts = payload.merchant_oid.split('-');
    if (parts.length < 4) {
      this.logger.error(`Invalid upgrade merchant_oid format: ${payload.merchant_oid}`);
      return;
    }

    const subscriptionId = parts[1];
    const newPlanId = parts[2];
    const billingCycle = parts[3];

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

    // Get the new plan info for notification
    const newPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: newPlanId },
    });

    // Apply the upgrade directly
    try {
      await this.subscriptionService.applyUpgrade(subscriptionId, newPlanId, billingCycle);
      this.logger.log(`Upgrade applied successfully: ${subscriptionId} -> ${newPlanId}`);

      // Send success notification
      if (payment) {
        const adminEmail = await this.getTenantAdminEmail(payment.subscription.tenantId);
        if (adminEmail && newPlan) {
          await this.notificationService.sendPaymentSuccessful(
            adminEmail,
            payment.subscription.tenant.name,
            Number(payment.amount),
            payment.currency,
            `Plan upgraded to ${newPlan.displayName}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Failed to apply upgrade: ${error.message}`, error.stack);
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
