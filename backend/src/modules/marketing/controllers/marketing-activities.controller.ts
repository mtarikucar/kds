import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { MarketingRoute } from '../decorators/marketing-public.decorator';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingRoles } from '../decorators/marketing-roles.decorator';
import { MarketingActivitiesService } from '../services/marketing-activities.service';
import { CreateActivityDto } from '../dto/create-activity.dto';
import { MarketingUserPayload } from '../types';

@MarketingRoute()
@Controller('marketing')
@UseGuards(MarketingGuard, MarketingRolesGuard)
@MarketingRoute()
export class MarketingActivitiesController {
  constructor(private readonly activitiesService: MarketingActivitiesService) {}

  @Post('leads/:leadId/activities')
  create(
    @Param('leadId') leadId: string,
    @Body() dto: CreateActivityDto,
    @CurrentMarketingUser() user: MarketingUserPayload,
  ) {
    return this.activitiesService.create(leadId, dto, user.id, user.role);
  }

  @Get('leads/:leadId/activities')
  findByLead(
    @Param('leadId') leadId: string,
    @CurrentMarketingUser() user: MarketingUserPayload,
  ) {
    return this.activitiesService.findByLead(leadId, user.id, user.role);
  }

  @Delete('activities/:id')
  @MarketingRoles('SALES_MANAGER')
  delete(@Param('id') id: string) {
    return this.activitiesService.delete(id);
  }
}
