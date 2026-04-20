import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { MarketingRoute } from '../decorators/marketing-public.decorator';
import { MarketingRoles } from '../decorators/marketing-roles.decorator';
import { MarketingReportsService } from '../services/marketing-reports.service';
import { ReportFilterDto } from '../dto/report-filter.dto';

@MarketingRoute()
@Controller('marketing/reports')
@UseGuards(MarketingGuard, MarketingRolesGuard)
@MarketingRoute()
export class MarketingReportsController {
  constructor(private readonly reportsService: MarketingReportsService) {}

  @Get('performance')
  @MarketingRoles('SALES_MANAGER')
  getPerformance(@Query() filter: ReportFilterDto) {
    return this.reportsService.getPerformanceReport(filter);
  }

  // Aggregate reports show data across every rep, so only managers
  // should see them; otherwise a SALES_REP can read the whole team's
  // conversion funnel and regional performance.
  @Get('lead-sources')
  @MarketingRoles('SALES_MANAGER')
  getLeadSources(@Query() filter: ReportFilterDto) {
    return this.reportsService.getLeadSourceReport(filter);
  }

  @Get('regional')
  @MarketingRoles('SALES_MANAGER')
  getRegional(@Query() filter: ReportFilterDto) {
    return this.reportsService.getRegionalReport(filter);
  }

  @Get('conversion')
  @MarketingRoles('SALES_MANAGER')
  getConversion(@Query() filter: ReportFilterDto) {
    return this.reportsService.getConversionFunnel(filter);
  }
}
