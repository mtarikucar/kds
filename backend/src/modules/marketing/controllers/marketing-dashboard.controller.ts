import { Controller, Get, UseGuards } from '@nestjs/common';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { CurrentMarketingUser } from '../decorators/current-marketing-user.decorator';
import { MarketingRoles } from '../decorators/marketing-roles.decorator';
import { MarketingDashboardService } from '../services/marketing-dashboard.service';

@Controller('marketing/dashboard')
@UseGuards(MarketingGuard, MarketingRolesGuard)
export class MarketingDashboardController {
  constructor(private readonly dashboardService: MarketingDashboardService) {}

  @Get('stats')
  getStats(@CurrentMarketingUser() user: any) {
    return this.dashboardService.getStats(user.id, user.role);
  }

  @Get('leads-by-status')
  getLeadsByStatus(@CurrentMarketingUser() user: any) {
    return this.dashboardService.getLeadsByStatus(user.id, user.role);
  }

  @Get('today')
  getTodaySummary(@CurrentMarketingUser() user: any) {
    return this.dashboardService.getTodaySummary(user.id, user.role);
  }

  @Get('monthly')
  getMonthlyMetrics(@CurrentMarketingUser() user: any) {
    return this.dashboardService.getMonthlyMetrics(user.id, user.role);
  }

  @Get('top-performers')
  @MarketingRoles('SALES_MANAGER')
  getTopPerformers() {
    return this.dashboardService.getTopPerformers();
  }
}
