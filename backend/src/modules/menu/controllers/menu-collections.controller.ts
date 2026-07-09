import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from "@nestjs/swagger";
import { MenuCollectionsService } from "../services/menu-collections.service";
import {
  CreateMenuCollectionDto,
  UpdateMenuCollectionDto,
} from "../dto/menu-collection.dto";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";

@ApiTags("menu-collections")
@ApiBearerAuth()
@Controller("menu/collections")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class MenuCollectionsController {
  constructor(private readonly service: MenuCollectionsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Create a menu collection (ADMIN, MANAGER)" })
  @ApiResponse({ status: 201, description: "Collection created" })
  create(@Body() dto: CreateMenuCollectionDto, @Request() req) {
    return this.service.create(dto, req.tenantId);
  }

  @Get()
  @ApiOperation({ summary: "List menu collections" })
  findAll(@Request() req) {
    return this.service.findAll(req.tenantId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a collection with its products" })
  findOne(@Param("id") id: string, @Request() req) {
    return this.service.findOne(id, req.tenantId);
  }

  @Patch(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Update a collection (ADMIN, MANAGER)" })
  update(
    @Param("id") id: string,
    @Body() dto: UpdateMenuCollectionDto,
    @Request() req,
  ) {
    return this.service.update(id, dto, req.tenantId);
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Delete a collection (ADMIN, MANAGER)" })
  remove(@Param("id") id: string, @Request() req) {
    return this.service.remove(id, req.tenantId);
  }
}
