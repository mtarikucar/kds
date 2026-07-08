import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { AccountingSettingsService } from "../services/accounting-settings.service";
import { AccountingSyncService } from "../services/accounting-sync.service";
import { UpdateAccountingSettingsDto } from "../dto/accounting-settings.dto";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { RequiresIntegration } from "../../subscriptions/decorators/requires-integration.decorator";

// v2.8.90 — accounting credential surface gated on integration. Tenants
// without any accounting add-on shouldn't see vendor connect / sync
// endpoints; this gate mirrors the sidebar rule server-side.
@ApiTags("accounting-settings")
@ApiBearerAuth()
@Controller("accounting-settings")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresIntegration("accounting")
export class AccountingSettingsController {
  constructor(
    private readonly service: AccountingSettingsService,
    private readonly syncService: AccountingSyncService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async findByTenant(@Request() req) {
    const settings = await this.service.findByTenant(req.tenantId);
    return this.service.sanitize(settings);
  }

  @Patch()
  @Roles(UserRole.ADMIN)
  async update(@Request() req, @Body() dto: UpdateAccountingSettingsDto) {
    const settings = await this.service.update(req.tenantId, dto);
    return this.service.sanitize(settings);
  }

  @Post("test-connection")
  @Roles(UserRole.ADMIN)
  testConnection(@Request() req) {
    return this.syncService.testConnection(req.tenantId);
  }

  @Get("e-document/readiness")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  eDocumentReadiness() {
    return this.syncService.eDocumentReadiness();
  }

  @Post("e-document/resync-failed")
  @Roles(UserRole.ADMIN)
  resyncFailed(@Request() req) {
    return this.syncService
      .resyncFailedInvoices(req.tenantId)
      .then((retried) => ({ retried }));
  }

  @Get("sync-status")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  syncStatus(@Request() req) {
    return this.service.getSyncStatus(req.tenantId);
  }
}
