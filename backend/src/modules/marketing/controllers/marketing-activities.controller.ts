import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { MarketingRoute } from '../decorators/marketing-route.decorator';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingRoles } from '../decorators/marketing-roles.decorator';
import { MarketingActivitiesService } from '../services/marketing-activities.service';
import { CreateActivityDto } from '../dto/create-activity.dto';

@MarketingRoute()
@Controller('marketing')
@UseGuards(MarketingGuard, MarketingRolesGuard)
export class MarketingActivitiesController {
  constructor(private readonly activitiesService: MarketingActivitiesService) {}

  @Post('leads/:leadId/activities')
  create(
    @Param('leadId') leadId: string,
    @Body() dto: CreateActivityDto,
    @CurrentMarketingUser() user: any,
  ) {
    return this.activitiesService.create(leadId, dto, user.id, user.role);
  }

  @Get('leads/:leadId/activities')
  findByLead(
    @Param('leadId') leadId: string,
    @CurrentMarketingUser() user: any,
  ) {
    return this.activitiesService.findByLead(leadId, user.id, user.role);
  }

  @Delete('activities/:id')
  @MarketingRoles('SALES_MANAGER')
  delete(@Param('id') id: string) {
    return this.activitiesService.delete(id);
  }
}
