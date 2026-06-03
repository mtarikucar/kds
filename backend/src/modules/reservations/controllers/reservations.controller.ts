import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { CurrentScope } from "../../auth/decorators/current-scope.decorator";
import { SkipBranchScope } from "../../auth/decorators/skip-branch-scope.decorator";
import { BranchScope } from "../../../common/scoping/branch-scope";
import { ReservationsService } from "../services/reservations.service";
import { ReservationSettingsService } from "../services/reservation-settings.service";
import { UpdateReservationDto } from "../dto/update-reservation.dto";
import { RejectReservationDto } from "../dto/update-reservation.dto";
import { UpdateReservationSettingsDto } from "../dto/update-reservation-settings.dto";
import { ReservationQueryDto } from "../dto/reservation-query.dto";

@ApiTags("reservations")
@ApiBearerAuth()
@Controller("reservations")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.RESERVATION_SYSTEM)
export class ReservationsController {
  constructor(
    private readonly reservationsService: ReservationsService,
    private readonly settingsService: ReservationSettingsService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "Get all reservations with filters" })
  findAll(
    @CurrentScope() scope: BranchScope,
    @Query() query: ReservationQueryDto,
  ) {
    return this.reservationsService.findAll(scope, query);
  }

  @Get("stats")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Get reservation statistics" })
  getStats(@CurrentScope() scope: BranchScope, @Query("date") date?: string) {
    return this.reservationsService.getStats(scope, date);
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "Get reservation by ID" })
  findOne(@CurrentScope() scope: BranchScope, @Param("id") id: string) {
    return this.reservationsService.findOne(scope, id);
  }

  @Patch(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Update reservation" })
  update(
    @CurrentScope() scope: BranchScope,
    @Param("id") id: string,
    @Body() dto: UpdateReservationDto,
  ) {
    return this.reservationsService.update(scope, id, dto);
  }

  @Patch(":id/confirm")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Confirm reservation" })
  confirm(@CurrentScope() scope: BranchScope, @Param("id") id: string) {
    return this.reservationsService.confirm(scope, id, scope.userId);
  }

  @Patch(":id/reject")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Reject reservation" })
  reject(
    @CurrentScope() scope: BranchScope,
    @Param("id") id: string,
    @Body() dto: RejectReservationDto,
  ) {
    return this.reservationsService.reject(scope, id, dto.rejectionReason);
  }

  @Patch(":id/seat")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "Mark reservation as seated" })
  seat(@CurrentScope() scope: BranchScope, @Param("id") id: string) {
    return this.reservationsService.seat(scope, id);
  }

  @Patch(":id/complete")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "Complete reservation" })
  complete(@CurrentScope() scope: BranchScope, @Param("id") id: string) {
    return this.reservationsService.complete(scope, id);
  }

  @Patch(":id/no-show")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Mark reservation as no-show" })
  noShow(@CurrentScope() scope: BranchScope, @Param("id") id: string) {
    return this.reservationsService.noShow(scope, id);
  }

  @Patch(":id/cancel")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Cancel reservation" })
  cancelAdmin(@CurrentScope() scope: BranchScope, @Param("id") id: string) {
    return this.reservationsService.cancel(scope, id, scope.userId);
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Delete reservation" })
  remove(@CurrentScope() scope: BranchScope, @Param("id") id: string) {
    return this.reservationsService.remove(scope, id);
  }

  // Settings endpoints — ReservationSettings is tenant-scoped (one row
  // per tenant; per-branch override row is a v3.1 follow-up). The lint
  // rule requires explicit @SkipBranchScope on tenant-wide handlers.
  @Get("settings/current")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @SkipBranchScope()
  @ApiOperation({ summary: "Get reservation settings" })
  getSettings(@Request() req) {
    return this.settingsService.getOrCreate(req.tenantId);
  }

  @Patch("settings/current")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @SkipBranchScope()
  @ApiOperation({ summary: "Update reservation settings" })
  updateSettings(@Request() req, @Body() dto: UpdateReservationSettingsDto) {
    return this.settingsService.update(req.tenantId, dto);
  }
}
