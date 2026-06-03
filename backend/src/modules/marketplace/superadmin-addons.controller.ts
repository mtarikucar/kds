import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SuperAdminGuard } from "../superadmin/guards/superadmin.guard";
import { SuperAdminRoute } from "../superadmin/decorators/superadmin.decorator";
import { AddOnCatalogService } from "./addon-catalog.service";
import { CreateAddOnDto, UpdateAddOnDto } from "./dto/addon.dto";

/**
 * Catalog admin surface. Mounted under /v1/superadmin/marketplace so the
 * route prefix matches the existing super-admin convention. The
 * SuperAdminGuard owns both authentication AND authorisation for these
 * endpoints (super-admin is a separate principal, not a User role).
 *
 * v2.8.90 — @SuperAdminRoute() tells the global JwtAuthGuard +
 * TenantGuard to skip; pre-v2.8.90 the class returned 401 because the
 * tenant-realm JWT guard couldn't verify the SuperAdmin-signed JWT.
 */
@ApiTags("SuperAdmin · Marketplace")
@ApiBearerAuth()
@SuperAdminRoute()
@UseGuards(SuperAdminGuard)
@Controller("v1/superadmin/marketplace/addons")
export class SuperadminAddOnsController {
  constructor(private readonly catalog: AddOnCatalogService) {}

  @Get()
  @ApiOperation({ summary: "List every add-on in the catalog" })
  list(@Query("status") status?: string, @Query("kind") kind?: string) {
    return this.catalog.list({ status, kind });
  }

  @Post()
  @ApiOperation({ summary: "Create a new add-on" })
  async create(@Body() dto: CreateAddOnDto) {
    if (dto.deps && dto.deps.length > 0) {
      await this.catalog.resolveDeps(dto.deps);
    }
    return this.catalog.create(dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update an existing add-on (code is immutable)" })
  async update(@Param("id") id: string, @Body() dto: UpdateAddOnDto) {
    if (dto.deps && dto.deps.length > 0) {
      await this.catalog.resolveDeps(dto.deps);
    }
    return this.catalog.update(id, dto);
  }

  @Delete(":id")
  @ApiOperation({
    summary:
      "Archive an add-on (soft delete; active tenants keep their entitlement)",
  })
  archive(@Param("id") id: string) {
    return this.catalog.archive(id);
  }
}
