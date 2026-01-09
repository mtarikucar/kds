import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  SetMetadata,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SubscriptionService } from '../services/subscription.service';
import { BillingService } from '../services/billing.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';
import { UpdateSubscriptionDto } from '../dto/update-subscription.dto';
import { ChangePlanDto } from '../dto/change-plan.dto';

export const Public = () => SetMetadata('isPublic', true);

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
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
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getCurrentSubscription(@Request() req) {
    const tenantId = req.user.tenantId;
    return await this.subscriptionService.getCurrentSubscription(tenantId);
  }

  /**
   * Get subscription by ID
   */
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getSubscription(@Param('id') id: string) {
    return await this.subscriptionService.getSubscriptionById(id);
  }

  /**
   * Create a new subscription
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async createSubscription(@Request() req, @Body() dto: CreateSubscriptionDto) {
    const tenantId = req.user.tenantId;
    return await this.subscriptionService.createSubscription(tenantId, dto);
  }

  /**
   * Update subscription settings
   */
  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
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
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async changePlan(@Param('id') id: string, @Body() dto: ChangePlanDto) {
    return await this.subscriptionService.changePlan(id, dto);
  }

  /**
   * Get pending plan change for a subscription
   */
  @Get(':id/pending-change')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getPendingPlanChange(@Param('id') id: string) {
    return await this.subscriptionService.getPendingPlanChange(id);
  }

  /**
   * Cancel subscription
   */
  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
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
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async reactivateSubscription(@Param('id') id: string) {
    return await this.subscriptionService.reactivateSubscription(id);
  }

  /**
   * Get subscription invoices
   */
  @Get(':id/invoices')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getInvoices(@Param('id') id: string) {
    return await this.billingService.getSubscriptionInvoices(id);
  }

  /**
   * Apply pending plan change (after payment confirmation)
   */
  @Post('apply-plan-change/:pendingChangeId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async applyPlanChange(@Param('pendingChangeId') pendingChangeId: string) {
    return await this.subscriptionService.applyPlanChange(pendingChangeId);
  }

  /**
   * Cancel pending plan change
   */
  @Delete(':id/pending-change')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async cancelPendingPlanChange(@Param('id') id: string) {
    return await this.subscriptionService.cancelPendingPlanChange(id);
  }

  /**
   * Get all invoices for current tenant
   */
  @Get('tenant/invoices')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getTenantInvoices(@Request() req) {
    const tenantId = req.user.tenantId;
    return await this.billingService.getTenantInvoices(tenantId);
  }
}
