import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { MarketingRoute } from '../decorators/marketing-public.decorator';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingRoles } from '../decorators/marketing-roles.decorator';
import { MarketingLeadsService } from '../services/marketing-leads.service';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { UpdateLeadDto } from '../dto/update-lead.dto';
import { LeadFilterDto } from '../dto/lead-filter.dto';
import { ConvertLeadDto } from '../dto/convert-lead.dto';
import { UpdateLeadStatusDto } from '../dto/update-lead-status.dto';
import { AssignLeadDto } from '../dto/assign-lead.dto';
import { MarketingUserPayload } from '../types';

@Controller('marketing/leads')
@UseGuards(MarketingGuard, MarketingRolesGuard)
@MarketingRoute()
export class MarketingLeadsController {
  constructor(private readonly leadsService: MarketingLeadsService) {}

  @Post()
  create(@Body() dto: CreateLeadDto, @CurrentMarketingUser() user: MarketingUserPayload) {
    return this.leadsService.create(dto, user.id);
  }

  @Get()
  findAll(@Query() filter: LeadFilterDto, @CurrentMarketingUser() user: MarketingUserPayload) {
    return this.leadsService.findAll(filter, user.id, user.role);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentMarketingUser() user: MarketingUserPayload) {
    return this.leadsService.findOne(id, user.id, user.role);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentMarketingUser() user: MarketingUserPayload,
  ) {
    return this.leadsService.update(id, dto, user.id, user.role);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateLeadStatusDto,
    @CurrentMarketingUser() user: MarketingUserPayload,
  ) {
    return this.leadsService.updateStatus(id, dto.status, dto.lostReason, user.id, user.role);
  }

  @Patch(':id/assign')
  @MarketingRoles('SALES_MANAGER')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignLeadDto,
    @CurrentMarketingUser() user: MarketingUserPayload,
  ) {
    return this.leadsService.assign(id, dto.assignedToId, user.id);
  }

  @Post(':id/convert')
  @MarketingRoles('SALES_MANAGER')
  convert(
    @Param('id') id: string,
    @Body() dto: ConvertLeadDto,
    @CurrentMarketingUser() user: MarketingUserPayload,
  ) {
    return this.leadsService.convert(id, dto, user.id);
  }

  @Delete(':id')
  @MarketingRoles('SALES_MANAGER')
  delete(@Param('id') id: string) {
    return this.leadsService.delete(id);
  }
}
