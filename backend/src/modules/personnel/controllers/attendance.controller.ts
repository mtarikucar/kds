import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Request,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { Throttle } from "@nestjs/throttler";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { CurrentScope } from "../../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../../common/scoping/branch-scope";
import { AttendanceService } from "../services/attendance.service";
import { CardShiftService } from "../services/card-shift.service";
import { ClockInDto } from "../dto/clock-in.dto";
import { CardTapDto } from "../dto/card-shift.dto";
import {
  AttendanceQueryDto,
  AttendanceSummaryQueryDto,
} from "../dto/attendance-query.dto";

@ApiTags("personnel/attendance")
@ApiBearerAuth()
@Controller("personnel/attendance")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT)
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly cardShiftService: CardShiftService,
  ) {}

  @Post("clock-in")
  @Roles(
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.WAITER,
    UserRole.KITCHEN,
    UserRole.COURIER,
  )
  @ApiOperation({ summary: "Clock in for today" })
  clockIn(@Request() req, @Body() dto: ClockInDto) {
    return this.attendanceService.clockIn(req.tenantId, req.user.id, dto.notes);
  }

  /**
   * The kiosk endpoint. The station tablet runs on an ADMIN/MANAGER session
   * (there is no device-token rail yet — §9/1), so the roles are theirs.
   *
   * BOTH flags in ONE call: the guard uses getAllAndOverride, so writing
   * @RequiresFeature here OVERRIDES the class-level personnelManagement
   * requirement instead of adding to it. Listing only cardShift would sell the
   * card rail to a tenant with no attendance module underneath it.
   */
  @Post("card-tap")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.PERSONNEL_MANAGEMENT, PlanFeature.CARD_SHIFT)
  // 90/dk, 30 değil. Tek bir RFID okuyucu fiziksel olarak dakikada ~30-40
  // okutma yapabiliyor (kart okutma + okuma + geri bildirim ~1,5-2 sn), yani
  // 30'luk sınır tam o tavana oturuyordu: bir yanlış okumaya, ikinci bir
  // tablete veya vardiya değişiminde kümelenen kuyruğa payı yoktu.
  //
  // Asıl tehlike "bir çalışan tekrar dener" değil: blockDuration ayarlanmadığı
  // için ttl'e eşit oluyor, yani sınır dolduğunda TÜM KİOSK 60 saniye boyunca
  // HERKESİ okutamaz hâle geliyor — tam da vardiya değişimi telaşında.
  //
  // Gevşetmek DoS hesabını değiştirmiyor: ThrottlerGuard global APP_GUARD
  // olarak auth zincirinden ÖNCE çalışıyor, yani bu bütçeyi kimlik doğrulama
  // korumuyor zaten; kimliksiz bir sel 30'u da 90'ı da aynı kolaylıkta tüketir.
  // short (10/1sn) ve medium (50/10sn) globalleri dokunulmadan duruyor ve
  // betiklenmiş bir sele karşı asıl backstop onlar.
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  @ApiOperation({ summary: "Clock in/out by tapping an RFID staff card" })
  cardTap(@Request() req, @Body() dto: CardTapDto) {
    return this.cardShiftService.tap(req.tenantId, dto);
  }

  @Post("clock-out")
  @Roles(
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.WAITER,
    UserRole.KITCHEN,
    UserRole.COURIER,
  )
  @ApiOperation({ summary: "Clock out for today" })
  clockOut(@Request() req) {
    return this.attendanceService.clockOut(req.tenantId, req.user.id);
  }

  @Post("break-start")
  @Roles(
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.WAITER,
    UserRole.KITCHEN,
    UserRole.COURIER,
  )
  @ApiOperation({ summary: "Start break" })
  breakStart(@Request() req) {
    return this.attendanceService.breakStart(req.tenantId, req.user.id);
  }

  @Post("break-end")
  @Roles(
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.WAITER,
    UserRole.KITCHEN,
    UserRole.COURIER,
  )
  @ApiOperation({ summary: "End break" })
  breakEnd(@Request() req) {
    return this.attendanceService.breakEnd(req.tenantId, req.user.id);
  }

  @Get("my-status")
  @Roles(
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.WAITER,
    UserRole.KITCHEN,
    UserRole.COURIER,
  )
  @ApiOperation({ summary: "Get current user today status" })
  getMyStatus(@CurrentScope() scope: BranchScope) {
    return this.attendanceService.getMyStatus(scope);
  }

  @Get("today")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Get all staff today attendance" })
  getTodayAttendance(@CurrentScope() scope: BranchScope) {
    return this.attendanceService.getTodayAttendance(scope);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Get attendance history" })
  getHistory(
    @CurrentScope() scope: BranchScope,
    @Query() query: AttendanceQueryDto,
  ) {
    return this.attendanceService.getAttendanceHistory(scope, query);
  }

  @Get("summary")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Get attendance summary" })
  getSummary(
    @CurrentScope() scope: BranchScope,
    @Query() query: AttendanceSummaryQueryDto,
  ) {
    return this.attendanceService.getAttendanceSummary(scope, query);
  }

  @Get("summary/export")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "Export the attendance summary (worked/overtime/late minutes) as CSV. Attendance/hours only — not a payroll or wage export.",
  })
  async exportSummary(
    @CurrentScope() scope: BranchScope,
    @Query() query: AttendanceSummaryQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.attendanceService.getAttendanceSummaryCsv(
      scope,
      query,
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=attendance-summary.csv",
    );
    res.send(csv);
  }
}
