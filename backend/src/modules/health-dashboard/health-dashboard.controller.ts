import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';
import { HealthDashboardService } from './health-dashboard.service';

// v2.8.88: ADMIN/MANAGER only. Operational visibility — should not be
// available to WAITER/KITCHEN/COURIER. No feature gate (basic health
// is free for every plan).
@ApiTags('Health Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('v1/health')
export class HealthDashboardController {
  constructor(private readonly svc: HealthDashboardService) {}

  @Get('branches')
  @ApiOperation({ summary: 'Health score for every active branch — drives the chain dashboard' })
  branches(@Req() req: any) {
    return this.svc.tenantOverview(req.user.tenantId);
  }

  @Get('branches/:branchId')
  branch(@Req() req: any, @Param('branchId') branchId: string) {
    return this.svc.branchScore(req.user.tenantId, branchId);
  }
}
