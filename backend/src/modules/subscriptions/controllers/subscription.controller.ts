import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SubscriptionService } from '../services/subscription.service';
import { BillingService } from '../services/billing.service';
import { Public } from '../../auth/decorators/public.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { CreateSubscriptionDto } from '../dto/create-subscription.dto';
import { UpdateSubscriptionDto } from '../dto/update-subscription.dto';
import { ChangePlanDto } from '../dto/change-plan.dto';

/**
 * Every :id endpoint threads `req.user.tenantId` into the service so
 * cross-tenant IDOR is impossible. Global guards (JwtAuthGuard /
 * TenantGuard / RolesGuard) are applied via APP_GUARD — no need to
 * redeclare them here.
 */
@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly billingService: BillingService,
  ) {}

  @Public()
  @Get('plans')
  async getPlans() {
    return this.subscriptionService.getAvailablePlans();
  }

  @Get('effective-features')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getEffectiveFeatures(@Request() req) {
    return this.subscriptionService.getEffectiveFeatures(req.user.tenantId);
  }

  @Get('current')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getCurrentSubscription(@Request() req) {
    return this.subscriptionService.getCurrentSubscription(req.user.tenantId);
  }

  @Get('tenant/invoices')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getTenantInvoices(
    @Request() req,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.billingService.getTenantInvoices(
      req.user.tenantId,
      page ? parseInt(page, 10) : undefined,
      pageSize ? parseInt(pageSize, 10) : undefined,
    );
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getSubscription(@Param('id') id: string, @Request() req) {
    return this.subscriptionService.getSubscriptionById(id, req.user.tenantId);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async createSubscription(@Request() req, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptionService.createSubscription(req.user.tenantId, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async updateSubscription(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
    @Request() req,
  ) {
    return this.subscriptionService.updateSubscription(
      id,
      req.user.tenantId,
      dto,
    );
  }

  @Post(':id/change-plan')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async changePlan(
    @Param('id') id: string,
    @Body() dto: ChangePlanDto,
    @Request() req,
  ) {
    return this.subscriptionService.changePlan(id, req.user.tenantId, dto);
  }

  @Get(':id/scheduled-downgrade')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getScheduledDowngrade(@Param('id') id: string, @Request() req) {
    return this.subscriptionService.getScheduledDowngrade(id, req.user.tenantId);
  }

  @Delete(':id/scheduled-downgrade')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async cancelScheduledDowngrade(@Param('id') id: string, @Request() req) {
    return this.subscriptionService.cancelScheduledDowngrade(
      id,
      req.user.tenantId,
    );
  }

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async cancelSubscription(
    @Param('id') id: string,
    @Body() body: { immediate?: boolean; reason?: string },
    @Request() req,
  ) {
    return this.subscriptionService.cancelSubscription(
      id,
      req.user.tenantId,
      body.immediate || false,
      body.reason,
    );
  }

  @Post(':id/reactivate')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async reactivateSubscription(@Param('id') id: string, @Request() req) {
    return this.subscriptionService.reactivateSubscription(
      id,
      req.user.tenantId,
    );
  }

  @Get(':id/invoices')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async getInvoices(
    @Param('id') id: string,
    @Request() req,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.billingService.getSubscriptionInvoices(
      id,
      req.user.tenantId,
      page ? parseInt(page, 10) : undefined,
      pageSize ? parseInt(pageSize, 10) : undefined,
    );
  }
}
