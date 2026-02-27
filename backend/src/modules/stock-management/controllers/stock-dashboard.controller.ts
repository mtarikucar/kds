import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { StockDashboardService } from '../services/stock-dashboard.service';

@ApiTags('stock-management/dashboard')
@ApiBearerAuth()
@Controller('stock-management/dashboard')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class StockDashboardController {
  constructor(private readonly service: StockDashboardService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get stock management dashboard overview' })
  getDashboard(@Request() req) {
    return this.service.getDashboard(req.tenantId);
  }

  @Get('valuation')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get inventory valuation' })
  getValuation(@Request() req) {
    return this.service.getValuation(req.tenantId);
  }

  @Get('movement-summary')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get movement summary by type' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  getMovementSummary(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.getMovementSummary(req.tenantId, startDate, endDate);
  }
}
