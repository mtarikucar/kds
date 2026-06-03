import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../auth/decorators/public.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { SuperAdminGuard } from "../superadmin/guards/superadmin.guard";
import { SuperAdminRoute } from "../superadmin/decorators/superadmin.decorator";
import { CatalogService } from "./catalog.service";
import { HARDWARE_CATEGORIES } from "./category-vocabulary";
import { CreateHardwareProductDto } from "./dto/create-hardware-product.dto";
import { UpdateHardwareProductDto } from "./dto/update-hardware-product.dto";
import { ReceiveStockDto } from "./dto/receive-stock.dto";
import { HardwareQuoteRequestDto } from "./dto/hardware-quote-request.dto";

@ApiTags("Hardware Catalog")
@Controller("v1/catalog")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get("products")
  @ApiOperation({ summary: "Public hardware store — published products only" })
  listPublic(@Query("category") category?: string) {
    return this.catalog.listPublic({ category });
  }

  @Public()
  @Get("categories")
  @ApiOperation({
    summary:
      "Category vocabulary (value + TR label + order) — single source for storefront filters",
  })
  categories() {
    return HARDWARE_CATEGORIES;
  }

  @Public()
  @Get("products/sku/:sku")
  @ApiOperation({ summary: "Public product lookup by SKU" })
  bySku(@Param("sku") sku: string) {
    // v2.8.87: route through the public-view helper so the detail page
    // payload doesn't leak `allocated` / `serialsAvailable`. Internal
    // callers (CheckoutService quote/provision path) use
    // findBySkuOrThrow directly when they need the serials column.
    return this.catalog.findBySkuPublicOrThrow(sku);
  }
}

// Tenant-authenticated storefront actions. Separate from the @Public catalog
// controller because these need req.user.tenantId. The global JwtAuthGuard
// enforces auth (no @Public here); @Roles narrows to the buyer roles.
@ApiTags("Hardware Catalog")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/catalog")
export class TenantCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // "Teklif Al" on a QUOTE_ONLY device (yazarkasa / YN ÖKC). Records a
  // marketing Lead (source=HARDWARE_QUOTE) — these devices can't be bought
  // directly (the checkout guard blocks them); sale/activation/transfer go
  // through an authorized dealer/service + GİB.
  //
  // v3.0.1 round-4 audit fix — throttled. A compromised manager token can
  // otherwise fire unbounded leads at the marketing board (the DTO caps
  // qty ≤ 999 but not request frequency). 3 req / 10 s is the effective cap:
  // a few-per-second admin still fits, a script does not.
  //
  // NOTE on tier names: NestJS merges @Throttle overrides per-named-tier
  // against the globals (app.module: short=1s/10, medium=10s/50, long=60s/100).
  // We override `short`→10s/3 and `long`→60s/20; the un-overridden `medium`
  // (10s/50) stays active but is looser, so `short` is the binding limit.
  // The `short` ttl is INTENTIONALLY 10s here (not the global 1s) — do not
  // "restore" it to 1000 or the quote-spam guard loosens 10×.
  @Post("quote-request")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Throttle({ short: { ttl: 10_000, limit: 3 }, long: { ttl: 60_000, limit: 20 } })
  @ApiOperation({
    summary:
      "Request a quote for a QUOTE_ONLY device — creates a lead (ADMIN, MANAGER).",
  })
  requestQuote(@Req() req: any, @Body() body: HardwareQuoteRequestDto) {
    return this.catalog.requestQuote(req.user.tenantId, body);
  }
}

// v2.8.90 — @SuperAdminRoute() tells the global JwtAuthGuard +
// TenantGuard to skip; SuperAdmin tokens are minted with a different
// signing key + don't carry a tenantId. Pre-v2.8.90 this class
// returned 401 because the tenant-realm JwtAuthGuard couldn't verify
// the SuperAdmin-signed JWT.
@ApiTags("SuperAdmin · Hardware Catalog")
@ApiBearerAuth()
@SuperAdminRoute()
@UseGuards(SuperAdminGuard)
@Controller("v1/superadmin/catalog")
export class SuperadminCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("products")
  list(@Query("status") status?: string, @Query("category") category?: string) {
    return this.catalog.listAdmin({ status, category });
  }

  @Post("products")
  create(@Body() body: CreateHardwareProductDto) {
    return this.catalog.create(body);
  }

  @Patch("products/:id")
  update(@Param("id") id: string, @Body() body: UpdateHardwareProductDto) {
    return this.catalog.update(id, body);
  }

  @Delete("products/:id")
  archive(@Param("id") id: string) {
    return this.catalog.archive(id);
  }

  @Post("products/:id/stock")
  @ApiOperation({ summary: "Receive stock — optionally with serials" })
  receive(@Param("id") id: string, @Body() body: ReceiveStockDto) {
    return this.catalog.receiveStock(id, body.qty, body.serials);
  }
}
