import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
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
import { ScheduleService } from '../services/schedule.service';
import { AssignShiftDto, BulkAssignShiftDto } from '../dto/assign-shift.dto';
import { ScheduleQueryDto } from '../dto/schedule-query.dto';

@ApiTags('personnel/schedule')
@ApiBearerAuth()
@Controller('personnel/schedule')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT)
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN, UserRole.COURIER)
  @ApiOperation({ summary: 'Get weekly schedule' })
  getWeeklySchedule(@Request() req, @Query() query: ScheduleQueryDto) {
    return this.scheduleService.getWeeklySchedule(req.tenantId, query.weekStart);
  }

  @Post('assign')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Assign shift to user' })
  assign(@Request() req, @Body() dto: AssignShiftDto) {
    return this.scheduleService.assign(req.tenantId, dto);
  }

  @Post('assign-bulk')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Bulk assign shifts' })
  assignBulk(@Request() req, @Body() dto: BulkAssignShiftDto) {
    return this.scheduleService.assignBulk(req.tenantId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Remove shift assignment' })
  remove(@Request() req, @Param('id') id: string) {
    return this.scheduleService.remove(id, req.tenantId);
  }
}
