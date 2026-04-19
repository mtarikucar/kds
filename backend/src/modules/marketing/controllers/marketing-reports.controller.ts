import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { MarketingGuard } from '../guards/marketing.guard';
import { MarketingRolesGuard } from '../guards/marketing-roles.guard';
import { MarketingRoute } from '../decorators/marketing-public.decorator';
import { MarketingRoles } from '../decorators/marketing-roles.decorator';
import { MarketingReportsService } from '../services/marketing-reports.service';
import { ReportFilterDto } from '../dto/report-filter.dto';

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

  @Get('lead-sources')
  getLeadSources(@Query() filter: ReportFilterDto) {
    return this.reportsService.getLeadSourceReport(filter);
  }

  @Get('regional')
  getRegional(@Query() filter: ReportFilterDto) {
    return this.reportsService.getRegionalReport(filter);
  }

  @Get('conversion')
  getConversion(@Query() filter: ReportFilterDto) {
    return this.reportsService.getConversionFunnel(filter);
  }
}
