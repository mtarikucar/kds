import {
  Controller,
  Get,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { SalesReportDto } from './dto/sales-report.dto';
import { TopProductsReportDto } from './dto/top-products.dto';
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
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO format)' })
  @ApiResponse({ status: 200, description: 'Sales summary report', type: SalesReportDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getSalesSummary(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.reportsService.getSalesSummary(req.tenantId, start, end);
  }

  @Get('top-products')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get top selling products (ADMIN, MANAGER)' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO format)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of products to return (default: 10)' })
  @ApiResponse({ status: 200, description: 'Top products report', type: TopProductsReportDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getTopProducts(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.reportsService.getTopProducts(req.tenantId, start, end, limitNum);
  }

  @Get('payments')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get payment method breakdown (ADMIN, MANAGER)' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO format)' })
  @ApiResponse({ status: 200, description: 'Payment method breakdown' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getPaymentMethodBreakdown(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.reportsService.getPaymentMethodBreakdown(req.tenantId, start, end);
  }

  @Get('orders-by-hour')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get orders grouped by hour (ADMIN, MANAGER)' })
  @ApiQuery({ name: 'date', required: false, description: 'Target date (ISO format, defaults to today)' })
  @ApiResponse({ status: 200, description: 'Orders by hour' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getOrdersByHour(
    @Request() req,
    @Query('date') date?: string,
  ) {
    const targetDate = date ? new Date(date) : undefined;
    return this.reportsService.getOrdersByHour(req.tenantId, targetDate);
  }

  @Get('customers')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get customer analytics report (ADMIN, MANAGER)' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO format)' })
  @ApiResponse({ status: 200, description: 'Customer analytics report' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getCustomerAnalytics(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.reportsService.getCustomerAnalytics(req.tenantId, start, end);
  }

  @Get('inventory')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.INVENTORY_TRACKING)
  @ApiOperation({ summary: 'Get inventory report (ADMIN, MANAGER)' })
  @ApiResponse({ status: 200, description: 'Inventory report' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getInventoryReport(@Request() req) {
    return this.reportsService.getInventoryReport(req.tenantId);
  }

  @Get('staff-performance')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.ADVANCED_REPORTS)
  @ApiOperation({ summary: 'Get staff performance report (ADMIN, MANAGER)' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (ISO format)' })
  @ApiResponse({ status: 200, description: 'Staff performance report' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async getStaffPerformance(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.reportsService.getStaffPerformance(req.tenantId, start, end);
  }
}
