import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
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
}
