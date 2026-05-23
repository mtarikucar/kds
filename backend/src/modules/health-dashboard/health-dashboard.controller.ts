import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HealthDashboardService } from './health-dashboard.service';

@ApiTags('Health Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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
