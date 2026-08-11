import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SkipBranchScope } from "../auth/decorators/skip-branch-scope.decorator";
import { CreditService } from "./credit.service";

/**
 * Prepaid credit balances.
 *
 * Separate from `/entitlements/me` on purpose: credits are a live balance, not
 * a folded entitlement set, and the entitlement read is cached for 30 seconds.
 * Serving a balance from that cache would show a customer credits they have
 * already spent.
 */
@ApiTags("credits")
@Controller("v1/credits")
@UseGuards(JwtAuthGuard)
@SkipBranchScope()
export class CreditsController {
  constructor(private readonly credits: CreditService) {}

  @Get("me")
  @ApiOperation({ summary: "Prepaid credit balances for the current tenant" })
  async me(@Req() req: any) {
    return { balances: await this.credits.balances(req.user.tenantId) };
  }
}
