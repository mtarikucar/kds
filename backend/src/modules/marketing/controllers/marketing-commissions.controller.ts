import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsNumber, Min } from 'class-validator';

class UpdateCommissionAmountDto {
  @IsNumber()
  @Min(0)
  amount: number;
}
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { MarketingRoute } from '../decorators/marketing-public.decorator';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingRoles } from '../decorators/marketing-roles.decorator';
import { MarketingCommissionsService } from '../services/marketing-commissions.service';
import { CommissionFilterDto } from '../dto/commission-filter.dto';
import { MarketingUserPayload } from '../types';

@Controller('marketing/commissions')
@UseGuards(MarketingGuard, MarketingRolesGuard)
@MarketingRoute()
export class MarketingCommissionsController {
  constructor(
    private readonly commissionsService: MarketingCommissionsService,
  ) {}

  @Get()
  findAll(
    @Query() filter: CommissionFilterDto,
    @CurrentMarketingUser() user: MarketingUserPayload,
  ) {
    return this.commissionsService.findAll(filter, user.id, user.role);
  }

  @Get('summary')
  getSummary(
    @CurrentMarketingUser() user: MarketingUserPayload,
    @Query('period') period?: string,
  ) {
    return this.commissionsService.getSummary(user.id, user.role, period);
  }

  @Patch(':id')
  @MarketingRoles('SALES_MANAGER')
  updateAmount(
    @Param('id') id: string,
    @Body() dto: UpdateCommissionAmountDto,
  ) {
    return this.commissionsService.updateAmount(id, dto.amount);
  }

  @Patch(':id/approve')
  @MarketingRoles('SALES_MANAGER')
  approve(@Param('id') id: string) {
    return this.commissionsService.approve(id);
  }

  @Patch(':id/pay')
  @MarketingRoles('SALES_MANAGER')
  markPaid(@Param('id') id: string) {
    return this.commissionsService.markPaid(id);
  }
}
