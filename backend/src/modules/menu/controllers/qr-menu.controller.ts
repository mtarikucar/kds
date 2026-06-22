import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { PrismaService } from "../../../prisma/prisma.service";
import { MenuQueryService } from "../services/menu-query.service";
import { Public } from "../../auth/decorators/public.decorator";

@ApiTags("qr-menu")
@Controller("qr-menu")
export class QrMenuController {
  constructor(
    private prisma: PrismaService,
    private menuQueryService: MenuQueryService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get("by-subdomain/:subdomain")
  @ApiOperation({
    summary: "Get public menu by subdomain (no authentication required)",
  })
  @ApiParam({ name: "subdomain", description: "Restaurant subdomain" })
  @ApiQuery({
    name: "tableId",
    required: false,
    description: "Optional table ID for table-specific QR codes",
  })
  @ApiResponse({
    status: 200,
    description: "Public menu with categories and products",
  })
  @ApiResponse({ status: 404, description: "Restaurant not found" })
  async getPublicMenuBySubdomain(
    @Param("subdomain") subdomain: string,
    @Query("tableId") tableId?: string,
  ) {
    // v2.8.91: filter inactive/suspended tenants. Pre-fix the by-subdomain
    // lookup skipped the status check and returned a menu for a
    // SUSPENDED/DELETED tenant — operationally wrong (suspended tenants
    // should appear offline) and a small leak (the public QR menu
    // proves the subdomain exists). Mirrors the by-tenantId path.
    const tenant = await this.prisma.tenant.findFirst({
      where: { subdomain, status: "ACTIVE" },
    });

    if (!tenant) {
      throw new NotFoundException("Restaurant not found");
    }

    return this.menuQueryService.getPublicMenu(tenant.id, { tableId });
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(":tenantId")
  @ApiOperation({
    summary: "Get public menu for QR code access (no authentication required)",
  })
  @ApiQuery({
    name: "tableId",
    required: false,
    description: "Optional table ID for table-specific QR codes",
  })
  @ApiResponse({
    status: 200,
    description: "Public menu with categories and products",
  })
  @ApiResponse({ status: 404, description: "Tenant not found" })
  async getPublicMenu(
    @Param("tenantId") tenantId: string,
    @Query("tableId") tableId?: string,
  ) {
    return this.menuQueryService.getPublicMenu(tenantId, { tableId });
  }
}
