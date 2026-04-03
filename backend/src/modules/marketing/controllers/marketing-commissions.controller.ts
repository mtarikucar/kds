import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingRoles } from '../decorators/marketing-roles.decorator';
import { MarketingCommissionsService } from '../services/marketing-commissions.service';
import { CommissionFilterDto } from '../dto/commission-filter.dto';

@Controller('marketing/commissions')
@UseGuards(MarketingGuard, MarketingRolesGuard)
export class MarketingCommissionsController {
  constructor(
    private readonly commissionsService: MarketingCommissionsService,
  ) {}

  @Get()
  findAll(
    @Query() filter: CommissionFilterDto,
    @CurrentMarketingUser() user: any,
  ) {
    return this.commissionsService.findAll(filter, user.id, user.role);
  }

  @Get('summary')
  getSummary(
    @CurrentMarketingUser() user: any,
    @Query('period') period?: string,
  ) {
    return this.commissionsService.getSummary(user.id, user.role, period);
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
