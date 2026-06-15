import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { CurrentScope } from "../../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../../common/scoping/branch-scope";
import { ScheduleService } from "../services/schedule.service";
import { AssignShiftDto, BulkAssignShiftDto } from "../dto/assign-shift.dto";
import { ScheduleQueryDto } from "../dto/schedule-query.dto";

@ApiTags("personnel/schedule")
@ApiBearerAuth()
@Controller("personnel/schedule")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT)
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.WAITER,
    UserRole.KITCHEN,
    UserRole.COURIER,
  )
  @ApiOperation({ summary: "Get weekly schedule" })
  getWeeklySchedule(
    @CurrentScope() scope: BranchScope,
    @Query() query: ScheduleQueryDto,
  ) {
    return this.scheduleService.getWeeklySchedule(scope, query.weekStart);
  }

  @Post("assign")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Assign shift to user" })
  assign(@CurrentScope() scope: BranchScope, @Body() dto: AssignShiftDto) {
    return this.scheduleService.assign(scope, dto);
  }

  @Post("assign-bulk")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Bulk assign shifts" })
  assignBulk(
    @CurrentScope() scope: BranchScope,
    @Body() dto: BulkAssignShiftDto,
  ) {
    return this.scheduleService.assignBulk(scope, dto);
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Remove shift assignment" })
  remove(@CurrentScope() scope: BranchScope, @Param("id") id: string) {
    return this.scheduleService.remove(scope, id);
  }
}
