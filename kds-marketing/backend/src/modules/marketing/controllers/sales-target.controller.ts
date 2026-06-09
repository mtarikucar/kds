import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { MarketingRoute } from '../decorators/marketing-public.decorator';
import { MarketingRoles } from '../decorators/marketing-roles.decorator';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { SalesTargetService } from '../services/sales-target.service';
import { SetTargetDto, TargetFilterDto } from '../dto/sales-target.dto';
import { MarketingUserPayload } from '../types';

/**
 * Phase 4: sales targets/quotas + performance-vs-target. Setting/removing
 * targets is SALES_MANAGER-only (the approval gate). Reps see only their own
 * targets/performance; managers see any rep or the whole team.
 */
@MarketingRoute()
@Controller('marketing')
@UseGuards(MarketingGuard, MarketingRolesGuard)
export class SalesTargetController {
  constructor(private readonly targets: SalesTargetService) {}

  @Post('targets')
  @MarketingRoles('SALES_MANAGER')
  set(@Body() dto: SetTargetDto, @CurrentMarketingUser() user: MarketingUserPayload) {
    return this.targets.setTarget(dto, user.id);
  }

  @Get('targets')
  list(@Query() filter: TargetFilterDto, @CurrentMarketingUser() user: MarketingUserPayload) {
    return this.targets.list(filter, user);
  }

  @Delete('targets/:id')
  @MarketingRoles('SALES_MANAGER')
  remove(@Param('id') id: string) {
    return this.targets.remove(id);
  }

  @Get('performance')
  performance(
    @Query('period') period: string | undefined,
    @Query('marketingUserId') marketingUserId: string | undefined,
    @CurrentMarketingUser() user: MarketingUserPayload,
  ) {
    const p = period && /^\d{4}-\d{2}$/.test(period) ? period : this.currentPeriod();
    // Reps see only their own attainment; managers see a specific rep or the team.
    if (user.role === 'SALES_REP') {
      return this.targets.performanceFor(user.id, p);
    }
    if (marketingUserId) {
      return this.targets.performanceFor(marketingUserId, p);
    }
    return this.targets.teamPerformance(p);
  }

  private currentPeriod(): string {
    return new Date().toISOString().slice(0, 7);
  }
}
