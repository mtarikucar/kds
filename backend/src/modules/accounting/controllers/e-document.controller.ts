import { Controller, Get, Post, Request, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RequiresIntegration } from "../../subscriptions/decorators/requires-integration.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
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
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
// v3.3.0 — gated on the FISCAL INTEGRATION, not on advancedReports.
//
// e-Fatura is sold as its own product (`fiscal_efatura`, integration.fiscal).
// While these routes sat behind `advancedReports`, a tenant who bought only
// e-Fatura could reach nothing: they had paid ₺1.990 for a capability whose
// entire surface was locked behind a different product. Reporting and
// e-document issuance are separate purchases, so they need separate gates.
@RequiresIntegration("fiscal")
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
