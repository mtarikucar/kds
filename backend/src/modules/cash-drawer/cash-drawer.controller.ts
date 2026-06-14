import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { CashDrawerService } from "./cash-drawer.service";
import { CreateCashDrawerMovementDto } from "./dto/create-cash-drawer-movement.dto";
import { RejectCashDrawerMovementDto } from "./dto/reject-cash-drawer-movement.dto";
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
  constructor(private readonly svc: CashDrawerService) {}

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
