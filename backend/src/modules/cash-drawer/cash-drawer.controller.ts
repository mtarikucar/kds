import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { CashDrawerService } from "./cash-drawer.service";
import { CashierSessionService } from "./cashier-session.service";
import { CreateCashDrawerMovementDto } from "./dto/create-cash-drawer-movement.dto";
import { RejectCashDrawerMovementDto } from "./dto/reject-cash-drawer-movement.dto";
import {
  OpenCashierSessionDto,
  CloseCashierSessionDto,
} from "./dto/cashier-session.dto";
import { CurrentScope } from "../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../common/scoping/branch-scope";

/**
 * v2.8.99 — cash drawer movement controller.
 *
 * Create is open to WAITER/MANAGER/ADMIN; the type→approval mapping
 * inside CashDrawerService decides whether the row needs review.
 *
 * Approve / reject are MANAGER/ADMIN only.
 */
@ApiTags("cash-drawer")
@ApiBearerAuth()
@Controller("cash-drawer")
export class CashDrawerController {
  constructor(
    private readonly svc: CashDrawerService,
    private readonly sessions: CashierSessionService,
  ) {}

  // ── Cashier sessions (shift + EOD reconciliation) ──────────────────────────

  @Post("sessions/open")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "Open a cashier session with an opening float" })
  openSession(
    @CurrentScope() scope: BranchScope,
    @Body() dto: OpenCashierSessionDto,
  ) {
    return this.sessions.open(
      scope,
      dto.userId ?? scope.userId,
      dto.openingFloat,
    );
  }

  @Get("sessions/current")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "Get the caller's currently open session" })
  currentSession(@CurrentScope() scope: BranchScope) {
    return this.sessions.getCurrent(scope, scope.userId);
  }

  @Get("sessions")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "List cashier sessions (ADMIN, MANAGER)" })
  listSessions(
    @CurrentScope() scope: BranchScope,
    @Query("status") status?: string,
  ) {
    return this.sessions.list(scope, { status });
  }

  @Get("sessions.csv")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="cashier-sessions.csv"')
  @ApiOperation({ summary: "Export cashier sessions (Z history) as CSV" })
  sessionsCsv(
    @CurrentScope() scope: BranchScope,
    @Query("status") status?: string,
  ) {
    return this.sessions.listCsv(scope, { status });
  }

  @Get("sessions/:id/x-report")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({
    summary: "X-report: mid-shift running expected cash (does not close)",
  })
  xReport(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.sessions.getXReport(scope, id);
  }

  @Patch("sessions/:id/close")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({
    summary: "Close a session — reconciles counted vs expected cash",
  })
  closeSession(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentScope() scope: BranchScope,
    @Body() dto: CloseCashierSessionDto,
  ) {
    return this.sessions.close(scope, id, dto);
  }

  @Post("movements")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({
    summary:
      "Create a cash drawer movement (DRAFT or APPROVED depending on type)",
  })
  create(
    @CurrentScope() scope: BranchScope,
    @Body() dto: CreateCashDrawerMovementDto,
  ) {
    return this.svc.create(scope.tenantId, scope.branchId, scope.userId, dto);
  }

  @Get("movements/pending")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "List DRAFT movements awaiting approval" })
  listPending(@CurrentScope() scope: BranchScope) {
    return this.svc.listPending(scope);
  }

  @Get("movements/:id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "Get one movement with audit trail" })
  findOne(
    @CurrentScope() scope: BranchScope,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.svc.findOne(scope, id);
  }

  @Patch("movements/:id/approve")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Approve a DRAFT movement (ADMIN/MANAGER)" })
  approve(
    @CurrentScope() scope: BranchScope,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.svc.approve(scope, id, {
      id: scope.userId,
      role: scope.role,
    });
  }

  @Patch("movements/:id/reject")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "Reject a DRAFT movement with a reason (ADMIN/MANAGER)",
  })
  reject(
    @CurrentScope() scope: BranchScope,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectCashDrawerMovementDto,
  ) {
    return this.svc.reject(
      scope,
      id,
      { id: scope.userId, role: scope.role },
      dto,
    );
  }
}
