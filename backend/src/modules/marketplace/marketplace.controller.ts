import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { Public } from "../auth/decorators/public.decorator";
import { AddOnCatalogService } from "./addon-catalog.service";
import { TenantMarketplaceService } from "./tenant-marketplace.service";

@ApiTags("Marketplace")
@Controller("v1/marketplace")
export class MarketplaceController {
  constructor(
    private readonly catalog: AddOnCatalogService,
    private readonly tenant: TenantMarketplaceService,
  ) {}

  // Public catalog endpoint — visible from the landing site, no auth needed.
  // Returns only `published` rows.
  @Public()
  @Get("addons")
  @ApiOperation({ summary: "Public marketplace catalogue (published add-ons)" })
  list(@Query("kind") kind?: string) {
    return this.catalog
      .listPublic()
      .then((rows) => (kind ? rows.filter((r) => r.kind === kind) : rows));
  }

  // v2.8.89 — money flow lockdown. Pre-v2.8.89 purchase + cancel carried
  // only @UseGuards(JwtAuthGuard) → any role (WAITER/KITCHEN/COURIER)
  // could buy a ₺7500 onsite_install_full add-on and saddle the tenant
  // with the charge, or cancel an active integration. The frontend
  // sidebar restricts to ADMIN/MANAGER but that's UX gating, not
  // defence. mine (read) → ADMIN/MANAGER; purchase + cancel → ADMIN-
  // only since they're subscription-level billing decisions.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Get("addons/mine")
  @ApiOperation({
    summary:
      "List add-ons currently held by the authenticated tenant (ADMIN/MANAGER)",
  })
  mine(@Req() req: any) {
    return this.tenant.listMine(req.user.tenantId);
  }

  // Tenant-aware catalogue: published add-ons annotated with `includedInPlan`
  // so the storefront marks features the tenant's plan already grants instead
  // of trying to sell them. Authenticated (unlike the @Public() list above)
  // because the annotation depends on the caller's entitlements. The landing
  // site keeps using the public, un-annotated endpoint.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Get("addons/available")
  @ApiOperation({
    summary:
      "Published add-ons annotated with includedInPlan for the authenticated tenant",
  })
  available(@Req() req: any, @Query("kind") kind?: string) {
    return this.tenant.listAvailable(req.user.tenantId, kind);
  }

  // SECURITY (deep-review C2): the tenant-facing free-grant endpoint
  // POST /v1/marketplace/addons/purchase has been REMOVED. It was guarded
  // only by @Roles(ADMIN) (an ordinary tenant-realm role) and called
  // tenant.purchase() with no paymentRef, so any restaurant owner could
  // activate a paid add-on (capacity packs, integrations) for free via
  // curl, bypassing the PayTR checkout rail wired in v3.2.11. Tenant-
  // initiated purchases now go ONLY through POST /v1/checkout/intent →
  // PayTR webhook → CheckoutSettlementService → tenant.purchase(paymentRef).
  // tenant.purchase() additionally refuses any priceCents>0 grant without a
  // paymentRef as defence in depth. Operator comps belong on the SuperAdmin
  // surface, not here.

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Delete("addons/:tenantAddOnId")
  @ApiOperation({
    summary: "Cancel a held add-on (ADMIN only — billing event)",
  })
  cancel(
    @Req() req: any,
    @Param("tenantAddOnId") id: string,
    @Query("immediate") immediate?: string,
  ) {
    return this.tenant.cancel(req.user.tenantId, id, immediate === "true");
  }
}
