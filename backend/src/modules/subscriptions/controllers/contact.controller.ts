import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContactService, ContactMethod } from '../services/contact.service';
import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { BillingCycle } from '../../../common/constants/subscription.enum';

export class SubscriptionInquiryDto {
  @IsString()
  @IsNotEmpty()
  planId: string;

  @IsEnum(BillingCycle)
  @IsNotEmpty()
  billingCycle: BillingCycle;

  @IsEnum(ContactMethod)
  @IsOptional()
  preferredMethod?: ContactMethod;
}

export class UpgradeInquiryDto {
  @IsString()
  @IsNotEmpty()
  subscriptionId: string;

  @IsString()
  @IsNotEmpty()
  newPlanId: string;

  @IsEnum(BillingCycle)
  @IsNotEmpty()
  billingCycle: BillingCycle;

  @IsEnum(ContactMethod)
  @IsOptional()
  preferredMethod?: ContactMethod;
}

@Controller('contact')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class ContactController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contactService: ContactService,
  ) {}

  /**
   * Get contact links for subscription inquiry
   */
  @Post('subscription-inquiry')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getSubscriptionContactLinks(@Request() req, @Body() dto: SubscriptionInquiryDto) {
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

    // Get admin user for customer info
    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId, role: 'ADMIN' },
    });

    const customerName = adminUser
      ? `${adminUser.firstName || ''} ${adminUser.lastName || ''}`.trim() || tenant.name
      : tenant.name;

    const whatsappLink = this.contactService.getWhatsAppLink(
      plan.displayName,
      dto.billingCycle,
      tenant.name
    );

    const emailLink = this.contactService.getEmailLink(
      plan.displayName,
      dto.billingCycle,
      tenant.name
    );

    const contactInfo = this.contactService.getContactInfo();

    // Record the inquiry
    await this.contactService.recordContactInquiry({
      tenantId,
      tenantName: tenant.name,
      planId: dto.planId,
      planName: plan.displayName,
      billingCycle: dto.billingCycle,
      method: dto.preferredMethod || ContactMethod.WHATSAPP,
      customerEmail: adminUser?.email || req.user.email,
      customerName,
    });

    return {
      planName: plan.displayName,
      billingCycle: dto.billingCycle,
      amount: dto.billingCycle === 'MONTHLY' ? Number(plan.monthlyPrice) : Number(plan.yearlyPrice),
      currency: plan.currency,
      whatsappLink,
      emailLink,
      whatsappNumber: contactInfo.whatsapp,
      email: contactInfo.email,
      message: 'Please contact us via WhatsApp or email to complete your subscription.',
    };
  }

  /**
   * Get contact links for plan upgrade inquiry
   */
  @Post('upgrade-inquiry')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getUpgradeContactLinks(@Request() req, @Body() dto: UpgradeInquiryDto) {
    const tenantId = req.user.tenantId;

    const subscription = await this.prisma.subscription.findUnique({
      where: { id: dto.subscriptionId },
      include: { tenant: true, plan: true },
    });

    if (!subscription) {
      throw new BadRequestException('Subscription not found');
    }

    if (subscription.tenantId !== tenantId) {
      throw new BadRequestException('Unauthorized');
    }

    const newPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.newPlanId },
    });

    if (!newPlan) {
      throw new BadRequestException('Plan not found');
    }

    const tenant = subscription.tenant;

    // Get admin user for customer info
    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId, role: 'ADMIN' },
    });

    const customerName = adminUser
      ? `${adminUser.firstName || ''} ${adminUser.lastName || ''}`.trim() || tenant.name
      : tenant.name;

    const whatsappLink = this.contactService.getWhatsAppLink(
      newPlan.displayName,
      dto.billingCycle,
      tenant.name
    );

    const emailLink = this.contactService.getEmailLink(
      newPlan.displayName,
      dto.billingCycle,
      tenant.name
    );

    const contactInfo = this.contactService.getContactInfo();

    // Record the inquiry
    await this.contactService.recordContactInquiry({
      tenantId,
      tenantName: tenant.name,
      planId: dto.newPlanId,
      planName: newPlan.displayName,
      billingCycle: dto.billingCycle,
      method: dto.preferredMethod || ContactMethod.WHATSAPP,
      customerEmail: adminUser?.email || req.user.email,
      customerName,
    });

    return {
      currentPlanName: subscription.plan?.displayName || 'Unknown',
      newPlanName: newPlan.displayName,
      billingCycle: dto.billingCycle,
      amount: dto.billingCycle === 'MONTHLY' ? Number(newPlan.monthlyPrice) : Number(newPlan.yearlyPrice),
      currency: newPlan.currency,
      whatsappLink,
      emailLink,
      whatsappNumber: contactInfo.whatsapp,
      email: contactInfo.email,
      message: 'Please contact us via WhatsApp or email to upgrade your plan.',
    };
  }

  /**
   * Get contact information
   */
  @Post('info')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getContactInfo() {
    return this.contactService.getContactInfo();
  }
}
