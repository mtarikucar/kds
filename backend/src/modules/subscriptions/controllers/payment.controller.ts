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
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaytrService } from '../services/paytr.service';
import { BillingService } from '../services/billing.service';
import { NotificationService } from '../services/notification.service';
import { CreatePaymentIntentDto } from '../dto/payment-intent.dto';
import { PaymentProvider, PaymentStatus, PaymentRegion } from '../../../common/constants/subscription.enum';

@Controller('payments')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class PaymentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paytrService: PaytrService,
    private readonly billingService: BillingService,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a payment intent for subscription payment
   * For Turkey: Uses PayTR
   * For International: Sends email request to admin
   */
  @Post('create-intent')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
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

    // Get admin user for email
    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId, role: 'ADMIN' },
    });

    // For non-Turkey customers: Send email request instead of payment
    if (paymentRegion !== PaymentRegion.TURKEY) {
      // Send email to admin
      const customerName = adminUser
        ? `${adminUser.firstName || ''} ${adminUser.lastName || ''}`.trim() || tenant.name
        : tenant.name;

      await this.notificationService.sendInternationalSubscriptionRequest(
        adminUser?.email || req.user.email,
        customerName,
        tenant.name,
        tenantId,
        plan.displayName,
        Number(amount),
        dto.billingCycle,
        plan.currency,
      );

      // Send confirmation to customer
      await this.notificationService.sendInternationalRequestConfirmation(
        adminUser?.email || req.user.email,
        tenant.name,
        plan.displayName,
      );

      return {
        provider: 'EMAIL',
        message: 'Your subscription request has been submitted. Our team will contact you shortly to complete the payment.',
        amount: Number(amount),
        currency: plan.currency,
      };
    }

    // For Turkey: Use PayTR
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
          paymentProvider: PaymentProvider.PAYTR,
          amount: Number(amount),
          currency: plan.currency,
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(),
        },
      });
    }

    // PayTR Link API flow
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    const merchantOid = `SUB-${subscription.id}-${Date.now()}`;

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

  /**
   * Create payment intent for plan change
   * For Turkey: Uses PayTR
   * For International: Sends email request to admin
   */
  @Post('create-plan-change-intent')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
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

    // Get admin user for email
    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId, role: 'ADMIN' },
    });

    // For non-Turkey (non-PayTR): Send email request
    if (pendingChange.paymentProvider !== PaymentProvider.PAYTR) {
      // Send email to admin
      const customerName = adminUser
        ? `${adminUser.firstName || ''} ${adminUser.lastName || ''}`.trim() || tenant.name
        : tenant.name;

      await this.notificationService.sendInternationalSubscriptionRequest(
        adminUser?.email || req.user.email,
        customerName,
        tenant.name,
        tenant.id,
        pendingChange.newPlan.displayName,
        amount,
        pendingChange.newBillingCycle,
        pendingChange.currency,
      );

      // Send confirmation to customer
      await this.notificationService.sendInternationalRequestConfirmation(
        adminUser?.email || req.user.email,
        tenant.name,
        pendingChange.newPlan.displayName,
      );

      return {
        provider: 'EMAIL',
        message: 'Your plan change request has been submitted. Our team will contact you shortly to complete the payment.',
        amount,
        currency: pendingChange.currency,
      };
    }

    // PayTR Link API flow for plan change
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    const merchantOid = `PLAN-${dto.pendingChangeId}-${Date.now()}`;

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

  /**
   * Get payment history for tenant
   */
  @Post('history')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
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
