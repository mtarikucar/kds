import {
  Controller,
  Get,
  Post,
  Body,
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
import { AttendanceService } from '../services/attendance.service';
import { ClockInDto } from '../dto/clock-in.dto';
import { AttendanceQueryDto, AttendanceSummaryQueryDto } from '../dto/attendance-query.dto';

@ApiTags('personnel/attendance')
@ApiBearerAuth()
@Controller('personnel/attendance')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('clock-in')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN, UserRole.COURIER)
  @ApiOperation({ summary: 'Clock in for today' })
  clockIn(@Request() req, @Body() dto: ClockInDto) {
    return this.attendanceService.clockIn(req.tenantId, req.user.id, dto.notes);
  }

  @Post('clock-out')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN, UserRole.COURIER)
  @ApiOperation({ summary: 'Clock out for today' })
  clockOut(@Request() req) {
    return this.attendanceService.clockOut(req.tenantId, req.user.id);
  }

  @Post('break-start')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN, UserRole.COURIER)
  @ApiOperation({ summary: 'Start break' })
  breakStart(@Request() req) {
    return this.attendanceService.breakStart(req.tenantId, req.user.id);
  }

  @Post('break-end')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN, UserRole.COURIER)
  @ApiOperation({ summary: 'End break' })
  breakEnd(@Request() req) {
    return this.attendanceService.breakEnd(req.tenantId, req.user.id);
  }

  @Get('my-status')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN, UserRole.COURIER)
  @ApiOperation({ summary: 'Get current user today status' })
  getMyStatus(@Request() req) {
    return this.attendanceService.getMyStatus(req.tenantId, req.user.id);
  }

  @Get('today')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all staff today attendance' })
  getTodayAttendance(@Request() req) {
    return this.attendanceService.getTodayAttendance(req.tenantId);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get attendance history' })
  getHistory(@Request() req, @Query() query: AttendanceQueryDto) {
    return this.attendanceService.getAttendanceHistory(req.tenantId, query);
  }

  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get attendance summary' })
  getSummary(@Request() req, @Query() query: AttendanceSummaryQueryDto) {
    return this.attendanceService.getAttendanceSummary(req.tenantId, query);
  }
}
