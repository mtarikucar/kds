import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { PlanFeatureGuard } from "../subscriptions/guards/plan-feature.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentScope } from "../auth/decorators/current-scope.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { BranchScope } from "../../common/scoping/branch-scope";
import { UserRole } from "../../common/constants/roles.enum";
import { PaymentTerminalService } from "./payment-terminal.service";
import { StartTerminalChargeDto } from "./dto/start-terminal-charge.dto";
import { RegisterTerminalDto } from "./dto/register-terminal.dto";
import { SetTerminalActivationDto } from "./dto/set-terminal-activation.dto";

@ApiTags("payment-terminal")
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
export class PaymentTerminalController {
  constructor(private readonly terminal: PaymentTerminalService) {}

  /** Tells the POS whether to drive a terminal (and whether it's a simulator)
   *  or fall back to the manual-card flow. */
  @Get("payment-terminal/active")
  @ApiOperation({
    summary: "Active card terminal for the current branch (or null)",
  })
  async active(@CurrentScope() scope: BranchScope) {
    const t = await this.terminal.resolveTerminal(scope);
    if (!t) return { active: false };
    return {
      active: true,
      providerId: t.providerId,
      activationState: t.activationState,
      simulator: t.activationState === "SIMULATOR",
    };
  }

  // ── Provisioning (ADMIN/MANAGER) ────────────────────────────────────────

  @Get("payment-terminal/providers")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "Registered terminal providers (for the register form)",
  })
  providers() {
    return this.terminal.listProviders();
  }

  @Get("payment-terminal/terminals")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Terminals registered for this branch" })
  terminals(@CurrentScope() scope: BranchScope) {
    return this.terminal.listTerminals(scope);
  }

  @Get("payment-terminal/reconciliation")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "Charges needing operator reconciliation (approved-unrecorded / needs-review)",
  })
  reconciliation(@CurrentScope() scope: BranchScope) {
    return this.terminal.listReconciliation(scope);
  }

  @Post("payment-terminal/terminals")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "Register a terminal (starts CONFIGURED_NOT_ACTIVE — fail-closed)",
  })
  register(
    @Body() dto: RegisterTerminalDto,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.terminal.registerTerminal(scope, dto);
  }

  @Patch("payment-terminal/terminals/:id/activation")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "Set a terminal's activation state (ACTIVE is gated)",
  })
  setActivation(
    @Param("id") id: string,
    @Body() dto: SetTerminalActivationDto,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.terminal.setActivation(scope, id, dto.activationState);
  }

  @Delete("payment-terminal/terminals/:id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Retire a terminal (stops resolving)" })
  remove(@Param("id") id: string, @CurrentScope() scope: BranchScope) {
    return this.terminal.removeTerminal(scope, id);
  }

  // ── Charging (ADMIN/MANAGER/WAITER) ─────────────────────────────────────

  @Post("orders/:orderId/terminal-charge")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({
    summary:
      "Start a card charge on the terminal (records nothing until APPROVED)",
  })
  start(
    @Param("orderId") orderId: string,
    @Body() dto: StartTerminalChargeDto,
    @CurrentScope() scope: BranchScope,
    @CurrentUser("id") userId: string,
  ) {
    return this.terminal.charge(scope, orderId, dto, userId);
  }

  @Get("orders/:orderId/terminal-charge/:chargeId")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({
    summary: "Poll a card charge; records the Payment once APPROVED",
  })
  poll(
    @Param("chargeId") chargeId: string,
    @CurrentScope() scope: BranchScope,
    @CurrentUser("id") userId: string,
  ) {
    return this.terminal.getCharge(scope, chargeId, userId);
  }

  @Post("orders/:orderId/terminal-charge/:chargeId/cancel")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "Abort a still-pending card charge" })
  cancel(
    @Param("chargeId") chargeId: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.terminal.cancel(scope, chargeId);
  }

  @Post("orders/:orderId/terminal-charge/:chargeId/void")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "Void a card charge (pre-settlement). A RECORDED charge must be reversed via the order refund flow.",
  })
  void(
    @Param("chargeId") chargeId: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.terminal.voidCharge(scope, chargeId);
  }
}
