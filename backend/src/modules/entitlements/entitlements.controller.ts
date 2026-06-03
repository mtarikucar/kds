import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { EntitlementService } from "./entitlement.service";

/**
 * Single read endpoint the dashboard (and any client) calls to know what
 * UI to render. Keeping this on the API server (rather than computing in
 * the client) ensures the same fold applies everywhere; the cache makes
 * it cheap to hit on every page load.
 */
@ApiTags("Entitlements")
@ApiBearerAuth()
@Controller("v1/entitlements")
@UseGuards(JwtAuthGuard)
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementService) {}

  @Get("me")
  @ApiOperation({
    summary: "Effective entitlement set for the authenticated tenant",
  })
  async me(@Req() req: any) {
    const tenantId: string = req.user.tenantId;
    const branchId: string | null = req.user?.branchId ?? null;
    return this.entitlements.getForTenant(tenantId, branchId);
  }
}
