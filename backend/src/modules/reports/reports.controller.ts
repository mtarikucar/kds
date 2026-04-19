import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { SalesReportDto } from './dto/sales-report.dto';
import { TopProductsReportDto } from './dto/top-products.dto';
import {
  DateRangeQueryDto,
  SingleDateQueryDto,
  TopProductsQueryDto,
} from './dto/query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PlanFeatureGuard } from '../subscriptions/guards/plan-feature.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequiresFeature } from '../subscriptions/decorators/requires-feature.decorator';
import { UserRole } from '../../common/constants/roles.enum';
import { PlanFeature } from '../../common/constants/subscription.enum';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get sales summary report (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, type: SalesReportDto })
  async getSalesSummary(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getSalesSummary(req.tenantId, start, end);
  }

  @Get('top-products')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get top selling products (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, type: TopProductsReportDto })
  async getTopProducts(@Request() req, @Query() query: TopProductsQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getTopProducts(req.tenantId, start, end, query.limit ?? 10);
  }

  @Get('payments')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get payment method breakdown (ADMIN, MANAGER)' })
  async getPaymentMethodBreakdown(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getPaymentMethodBreakdown(req.tenantId, start, end);
  }

  @Get('orders-by-hour')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get orders grouped by hour (ADMIN, MANAGER)' })
  async getOrdersByHour(@Request() req, @Query() query: SingleDateQueryDto) {
    const targetDate = query.date ? new Date(query.date) : undefined;
    return this.reportsService.getOrdersByHour(req.tenantId, targetDate);
  }

  @Get('customers')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get customer analytics report (ADMIN, MANAGER)' })
  async getCustomerAnalytics(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getCustomerAnalytics(req.tenantId, start, end);
  }

  @Get('inventory')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.INVENTORY_TRACKING)
  @ApiOperation({ summary: 'Get inventory report (ADMIN, MANAGER)' })
  async getInventoryReport(@Request() req) {
    return this.reportsService.getInventoryReport(req.tenantId);
  }

  @Get('staff-performance')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get staff performance report (ADMIN, MANAGER)' })
  async getStaffPerformance(@Request() req, @Query() query: DateRangeQueryDto) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    return this.reportsService.getStaffPerformance(req.tenantId, start, end);
  }
}
