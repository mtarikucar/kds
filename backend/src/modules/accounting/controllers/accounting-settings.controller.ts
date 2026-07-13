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
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";

// Gated on ADVANCED_REPORTS — the same feature the Muhasebe page (which now
// hosts these settings as its "Ayarlar" tab) is gated on. The prior
// @RequiresIntegration("accounting") gate 403'd for EVERY tenant because no
// plan or add-on ever grants integration.accounting, so the credential surface
// was permanently unreachable.
@ApiTags("accounting-settings")
@ApiBearerAuth()
@Controller("accounting-settings")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.ADVANCED_REPORTS)
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
    // Corrected/rotated credentials must take effect immediately: the sync
    // service caches provider tokens (Nilvera's static key for 24h), so
    // without this a fixed key keeps failing — and a rotated key keeps being
    // used — until the cache TTL lapses.
    this.syncService.clearTokenCache(req.tenantId);
    return this.service.sanitize(settings);
  }

  @Post("test-connection")
  @Roles(UserRole.ADMIN)
  testConnection(@Request() req) {
    return this.syncService.testConnection(req.tenantId);
  }

  @Get("sync-status")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  syncStatus(@Request() req) {
    return this.service.getSyncStatus(req.tenantId);
  }
}
