import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { PlanFeatureGuard } from '../../subscriptions/guards/plan-feature.guard';
import { RequiresFeature } from '../../subscriptions/decorators/requires-feature.decorator';
import { PlanFeature } from '../../../common/constants/subscription.enum';
import { StockDashboardService } from '../services/stock-dashboard.service';
// Iter-95: same shape as the iter-92 waste-logs summary DTO — startDate
// / endDate with @IsDateString. ValidationPipe rejects bad strings at
// the boundary; the service-side parseWindow adds NaN defense + 366d cap.
import { WasteLogsSummaryQueryDto } from '../dto/list-stock-logs.dto';

@ApiTags('stock-management/dashboard')
@ApiBearerAuth()
@Controller('stock-management/dashboard')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.INVENTORY_TRACKING)
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
  getMovementSummary(@Request() req, @Query() query: WasteLogsSummaryQueryDto) {
    return this.service.getMovementSummary(req.tenantId, query.startDate, query.endDate);
  }
}
