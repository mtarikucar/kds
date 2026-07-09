import { Controller, Get, Post, Request, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { AccountingSyncService } from "../services/accounting-sync.service";

/**
 * e-Belge readiness + FAILED re-sync, gated on ADVANCED_REPORTS (the same
 * feature the back-office 'Muhasebe & e-Belge' page is gated on) rather than the
 * accounting-settings controller's integration gate — which no plan grants, so
 * these endpoints would otherwise 403 for every tenant. Same paths as before.
 */
@ApiTags("accounting-settings")
@ApiBearerAuth()
@Controller("accounting-settings")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.ADVANCED_REPORTS)
export class EDocumentController {
  constructor(private readonly syncService: AccountingSyncService) {}

  @Get("e-document/readiness")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "e-document provider readiness (external config)" })
  eDocumentReadiness() {
    return this.syncService.eDocumentReadiness();
  }

  @Post("e-document/resync-failed")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Retry FAILED e-documents" })
  resyncFailed(@Request() req) {
    return this.syncService
      .resyncFailedInvoices(req.tenantId)
      .then((retried) => ({ retried }));
  }
}
