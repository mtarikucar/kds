import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SuperAdminDashboardService } from '../services/superadmin-dashboard.service';
import { SuperAdminAuditService } from '../services/superadmin-audit.service';
import { SuperAdminGuard } from '../guards/superadmin.guard';
import { SuperAdminRoute } from '../decorators/superadmin.decorator';

@ApiTags('SuperAdmin Dashboard')
@Controller('superadmin/dashboard')
@UseGuards(SuperAdminGuard)
@SuperAdminRoute()
@ApiBearerAuth()
export class SuperAdminDashboardController {
  constructor(
    private readonly dashboardService: SuperAdminDashboardService,
    private readonly auditService: SuperAdminAuditService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get system statistics' })
  async getStats() {
    return this.dashboardService.getStats();
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Get revenue analytics' })
  @ApiQuery({ name: 'period', enum: ['week', 'month', 'year'], required: false })
  async getRevenue(@Query('period') period: 'week' | 'month' | 'year' = 'month') {
    return this.dashboardService.getRevenueAnalytics(period);
  }

  @Get('growth')
  @ApiOperation({ summary: 'Get growth metrics' })
  async getGrowth() {
    return this.dashboardService.getGrowthMetrics();
  }

  @Get('plans')
  @ApiOperation({ summary: 'Get plan distribution' })
  async getPlanDistribution() {
    return this.dashboardService.getPlanDistribution();
  }

  @Get('recent')
  @ApiOperation({ summary: 'Get recent activities' })
  @ApiQuery({ name: 'limit', required: false })
  async getRecent(@Query('limit') limit: number = 10) {
    return this.dashboardService.getRecentActivity(limit);
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Get system alerts' })
  async getAlerts() {
    return this.dashboardService.getAlerts();
  }

  @Get('audit-recent')
  @ApiOperation({ summary: 'Get recent audit logs' })
  @ApiQuery({ name: 'limit', required: false })
  async getRecentAuditLogs(@Query('limit') limit: number = 10) {
    return this.auditService.getRecentActivity(limit);
  }
}
