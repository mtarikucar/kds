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
import { Public } from "../auth/decorators/public.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { SuperAdminGuard } from "../superadmin/guards/superadmin.guard";
import { SuperAdminRoute } from "../superadmin/decorators/superadmin.decorator";
import { CatalogService } from "./catalog.service";
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
  @Post("quote-request")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
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
