import {
  Controller,
  Get,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PlanFeatureGuard } from '../../subscriptions/guards/plan-feature.guard';
import { RequiresFeature } from '../../subscriptions/decorators/requires-feature.decorator';
import { PlanFeature } from '../../../common/constants/subscription.enum';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../../common/constants/roles.enum';
import { PerformanceService } from '../services/performance.service';
import { PerformanceQueryDto } from '../dto/performance-query.dto';

@ApiTags('personnel/performance')
@ApiBearerAuth()
@Controller('personnel/performance')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT)
export class PerformanceController {
  constructor(private readonly performanceService: PerformanceService) {}

  @Get('metrics')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get enhanced performance metrics' })
  getMetrics(@Request() req, @Query() query: PerformanceQueryDto) {
    return this.performanceService.getEnhancedMetrics(req.tenantId, query);
  }

  @Get('trends')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get monthly performance trends' })
  getTrends(@Request() req, @Query() query: PerformanceQueryDto) {
    return this.performanceService.getTrends(req.tenantId, query);
  }
}
