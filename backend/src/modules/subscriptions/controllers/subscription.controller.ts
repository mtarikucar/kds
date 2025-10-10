import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  SetMetadata,
} from '@nestjs/common';
import { SubscriptionService } from '../services/subscription.service';
import { BillingService } from '../services/billing.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';
import { UpdateSubscriptionDto } from '../dto/update-subscription.dto';
import { ChangePlanDto } from '../dto/change-plan.dto';

export const Public = () => SetMetadata('isPublic', true);

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly billingService: BillingService,
  ) {}

  /**
   * Get all available subscription plans (Public endpoint)
   */
  @Public()
  @Get('plans')
  async getPlans() {
    return await this.subscriptionService.getAvailablePlans();
  }

  /**
   * Get current tenant's subscription
   */
  @Get('current')
  async getCurrentSubscription(@Request() req) {
    const tenantId = req.user.tenantId;
    return await this.subscriptionService.getCurrentSubscription(tenantId);
  }

  /**
   * Get subscription by ID
   */
  @Get(':id')
  async getSubscription(@Param('id') id: string) {
    return await this.subscriptionService.getSubscriptionById(id);
  }

  /**
   * Create a new subscription
   */
  @Post()
  async createSubscription(@Request() req, @Body() dto: CreateSubscriptionDto) {
    const tenantId = req.user.tenantId;
    return await this.subscriptionService.createSubscription(tenantId, dto);
  }

  /**
   * Update subscription settings
   */
  @Patch(':id')
  async updateSubscription(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return await this.subscriptionService.updateSubscription(id, dto);
  }

  /**
   * Change subscription plan (upgrade/downgrade)
   */
  @Post(':id/change-plan')
  async changePlan(@Param('id') id: string, @Body() dto: ChangePlanDto) {
    return await this.subscriptionService.changePlan(id, dto);
  }

  /**
   * Cancel subscription
   */
  @Post(':id/cancel')
  async cancelSubscription(
    @Param('id') id: string,
    @Body() body: { immediate?: boolean; reason?: string },
  ) {
    return await this.subscriptionService.cancelSubscription(
      id,
      body.immediate || false,
      body.reason,
    );
  }

  /**
   * Reactivate a cancelled subscription
   */
  @Post(':id/reactivate')
  async reactivateSubscription(@Param('id') id: string) {
    return await this.subscriptionService.reactivateSubscription(id);
  }

  /**
   * Get subscription invoices
   */
  @Get(':id/invoices')
  async getInvoices(@Param('id') id: string) {
    return await this.billingService.getSubscriptionInvoices(id);
  }

  /**
   * Get all invoices for current tenant
   */
  @Get('tenant/invoices')
  async getTenantInvoices(@Request() req) {
    const tenantId = req.user.tenantId;
    return await this.billingService.getTenantInvoices(tenantId);
  }
}
