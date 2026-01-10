import {
  Controller,
  Post,
  Body,
  Logger,
  Res,
  SetMetadata,
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

// Public decorator to bypass authentication for webhooks
export const Public = () => SetMetadata('isPublic', true);

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
  @Public()
  @Post()
  async handleCallback(@Body() payload: PaytrCallbackPayload, @Res() res: Response) {
    this.logger.log(`Received PayTR callback for order: ${payload.merchant_oid}`);

    // Decode HTML entities in hash (PayTR sends URL/HTML encoded)
    if (payload.hash) {
      payload.hash = payload.hash
        .replace(/&#x2F;/g, '/')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    }

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

    // Check if this is an upgrade payment (UPG{timestamp} or UPGRADE-...)
    if (payload.merchant_oid.startsWith('UPG') || payload.merchant_oid.startsWith('UPGRADE-')) {
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
   */
  private async handleUpgradePaymentSuccess(payload: PaytrCallbackPayload) {
    this.logger.log(`Upgrade payment succeeded: ${payload.merchant_oid}`);

    // Find payment by merchant_oid
    const payment = await this.prisma.subscriptionPayment.findFirst({
      where: { paytrMerchantOid: payload.merchant_oid },
      include: {
        subscription: {
          include: { tenant: true },
        },
      },
    });

    if (!payment) {
      this.logger.error(`Upgrade payment not found for merchant_oid: ${payload.merchant_oid}`);
      return;
    }

    const subscription = payment.subscription;

    if (!subscription) {
      this.logger.error(`Subscription not found for payment: ${payment.id}`);
      return;
    }

    // Extract upgrade metadata from failureMessage BEFORE updating
    this.logger.log(`Payment failureMessage: ${payment.failureMessage}`);
    let upgradeMetadata: { type: string; newPlanId: string; billingCycle: string } | null = null;
    if (payment.failureMessage) {
      try {
        upgradeMetadata = JSON.parse(payment.failureMessage);
        this.logger.log(`Parsed upgrade metadata: ${JSON.stringify(upgradeMetadata)}`);
      } catch (e) {
        this.logger.warn(`Failed to parse upgrade metadata: ${e.message}`);
      }
    } else {
      this.logger.log('No failureMessage found in payment record');
    }

    // Update payment status
    await this.prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCEEDED,
        paidAt: new Date(),
        paytrPaymentToken: payload.merchant_oid,
        failureMessage: null, // Clear metadata on success
      },
    });

    // Apply the upgrade if metadata exists
    if (upgradeMetadata && upgradeMetadata.type === 'upgrade') {
      this.logger.log(`Applying upgrade to plan: ${upgradeMetadata.newPlanId}`);
      try {
        await this.subscriptionService.applyUpgrade(
          subscription.id,
          upgradeMetadata.newPlanId,
          upgradeMetadata.billingCycle,
        );
        this.logger.log(
          `Upgrade applied successfully: ${subscription.id} -> ${upgradeMetadata.newPlanId}`,
        );
      } catch (error) {
        this.logger.error(`Failed to apply upgrade: ${error.message}`, error.stack);
      }
    } else {
      this.logger.log(`Upgrade payment ${payment.id} marked as succeeded for subscription ${subscription.id} (no metadata or wrong type)`);
    }
    
    // Send notification
    const adminEmail = await this.getTenantAdminEmail(subscription.tenantId);
    if (adminEmail) {
      await this.notificationService.sendPaymentSuccessful(
        adminEmail,
        subscription.tenant.name,
        Number(payment.amount),
        payment.currency,
        payment.id,
      );
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
