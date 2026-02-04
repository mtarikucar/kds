import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SuperAdminSubscriptionsService } from '../services/superadmin-subscriptions.service';
import {
  SubscriptionFilterDto,
  CreatePlanDto,
  UpdatePlanDto,
  ExtendSubscriptionDto,
  UpdateSubscriptionDto,
} from '../dto/subscription-filter.dto';
import { SuperAdminGuard } from '../guards/superadmin.guard';
import { SuperAdminRoute } from '../decorators/superadmin.decorator';
import { CurrentSuperAdmin } from '../decorators/current-superadmin.decorator';

@ApiTags('SuperAdmin Subscriptions')
@Controller('superadmin')
@UseGuards(SuperAdminGuard)
@SuperAdminRoute()
@ApiBearerAuth()
export class SuperAdminSubscriptionsController {
  constructor(
    private readonly subscriptionsService: SuperAdminSubscriptionsService,
  ) {}

  // Plans
  @Get('plans')
  @ApiOperation({ summary: 'List all subscription plans' })
  async findAllPlans() {
    return this.subscriptionsService.findAllPlans();
  }

  @Post('plans')
  @ApiOperation({ summary: 'Create a new subscription plan' })
  async createPlan(
    @Body() createDto: CreatePlanDto,
    @CurrentSuperAdmin('id') actorId: string,
    @CurrentSuperAdmin('email') actorEmail: string,
  ) {
    return this.subscriptionsService.createPlan(createDto, actorId, actorEmail);
  }

  @Patch('plans/:id')
  @ApiOperation({ summary: 'Update a subscription plan' })
  async updatePlan(
    @Param('id') id: string,
    @Body() updateDto: UpdatePlanDto,
    @CurrentSuperAdmin('id') actorId: string,
    @CurrentSuperAdmin('email') actorEmail: string,
  ) {
    return this.subscriptionsService.updatePlan(id, updateDto, actorId, actorEmail);
  }

  @Delete('plans/:id')
  @ApiOperation({ summary: 'Delete a subscription plan' })
  async deletePlan(
    @Param('id') id: string,
    @CurrentSuperAdmin('id') actorId: string,
    @CurrentSuperAdmin('email') actorEmail: string,
  ) {
    return this.subscriptionsService.deletePlan(id, actorId, actorEmail);
  }

  // Subscriptions
  @Get('subscriptions')
  @ApiOperation({ summary: 'List all subscriptions' })
  async findAllSubscriptions(@Query() filters: SubscriptionFilterDto) {
    return this.subscriptionsService.findAllSubscriptions(filters);
  }

  @Get('subscriptions/:id')
  @ApiOperation({ summary: 'Get subscription details' })
  async findOneSubscription(@Param('id') id: string) {
    return this.subscriptionsService.findOneSubscription(id);
  }

  @Patch('subscriptions/:id')
  @ApiOperation({ summary: 'Update subscription' })
  async updateSubscription(
    @Param('id') id: string,
    @Body() updateDto: UpdateSubscriptionDto,
    @CurrentSuperAdmin('id') actorId: string,
    @CurrentSuperAdmin('email') actorEmail: string,
  ) {
    return this.subscriptionsService.updateSubscription(
      id,
      updateDto,
      actorId,
      actorEmail,
    );
  }

  @Post('subscriptions/:id/extend')
  @ApiOperation({ summary: 'Extend subscription period' })
  async extendSubscription(
    @Param('id') id: string,
    @Body() extendDto: ExtendSubscriptionDto,
    @CurrentSuperAdmin('id') actorId: string,
    @CurrentSuperAdmin('email') actorEmail: string,
  ) {
    return this.subscriptionsService.extendSubscription(
      id,
      extendDto,
      actorId,
      actorEmail,
    );
  }

  @Post('subscriptions/:id/cancel')
  @ApiOperation({ summary: 'Cancel subscription' })
  async cancelSubscription(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentSuperAdmin('id') actorId: string,
    @CurrentSuperAdmin('email') actorEmail: string,
  ) {
    return this.subscriptionsService.cancelSubscription(
      id,
      actorId,
      actorEmail,
      reason,
    );
  }
}
