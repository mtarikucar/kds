import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from "@nestjs/swagger";
import { FloorPlanService } from "./floor-plan.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { PlanFeatureGuard } from "../subscriptions/guards/plan-feature.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentScope } from "../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../common/scoping/branch-scope";
import { UserRole } from "../../common/constants/roles.enum";
import {
  CreateFloorZoneDto,
  UpdateFloorZoneDto,
  ReorderZonesDto,
} from "./dto/floor-zone.dto";
import {
  CreateFloorElementDto,
  UpdateFloorElementDto,
} from "./dto/floor-element.dto";
import { SaveLayoutDto } from "./dto/save-layout.dto";

/**
 * 2D floor-plan API: zones (kat/bahçe/teras), their decorative/structural
 * elements, and bulk layout persistence. All routes are branch-scoped via
 * @CurrentScope. Reads are open to any authenticated role (the live POS/KDS
 * map consumes them); writes are ADMIN/MANAGER (floor-plan design).
 */
@ApiTags("floor-plan")
@ApiBearerAuth()
@Controller("floor-plan")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
export class FloorPlanController {
  constructor(private readonly floorPlan: FloorPlanService) {}

  @Get()
  @ApiOperation({ summary: "Get the full floor plan for the current branch" })
  @ApiResponse({
    status: 200,
    description: "Zones (with elements + tables) + unplaced tables",
  })
  getPlan(@CurrentScope() scope: BranchScope) {
    return this.floorPlan.getPlan(scope);
  }

  // ---- Zones (static routes before :id) ----

  @Post("zones")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Create a floor zone (ADMIN, MANAGER)" })
  @ApiResponse({ status: 201, description: "Zone created" })
  @ApiResponse({ status: 409, description: "Zone name already exists" })
  createZone(
    @Body() dto: CreateFloorZoneDto,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.floorPlan.createZone(scope, dto);
  }

  @Post("zones/reorder")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Reorder floor zones (ADMIN, MANAGER)" })
  reorderZones(
    @Body() dto: ReorderZonesDto,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.floorPlan.reorderZones(scope, dto);
  }

  @Patch("zones/:id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Update a floor zone (ADMIN, MANAGER)" })
  @ApiResponse({ status: 404, description: "Zone not found" })
  updateZone(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateFloorZoneDto,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.floorPlan.updateZone(scope, id, dto);
  }

  @Delete("zones/:id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "Delete a floor zone — its tables fall back to unplaced, its elements are removed (ADMIN, MANAGER)",
  })
  @ApiResponse({ status: 404, description: "Zone not found" })
  deleteZone(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.floorPlan.deleteZone(scope, id);
  }

  // ---- Elements ----

  @Post("elements")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Create a floor element (ADMIN, MANAGER)" })
  createElement(
    @Body() dto: CreateFloorElementDto,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.floorPlan.createElement(scope, dto);
  }

  @Patch("elements/:id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Update a floor element (ADMIN, MANAGER)" })
  @ApiResponse({ status: 404, description: "Element not found" })
  updateElement(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateFloorElementDto,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.floorPlan.updateElement(scope, id, dto);
  }

  @Delete("elements/:id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Delete a floor element (ADMIN, MANAGER)" })
  @ApiResponse({ status: 404, description: "Element not found" })
  deleteElement(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.floorPlan.deleteElement(scope, id);
  }

  // ---- Bulk layout save ----

  @Patch("layout")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "Persist a full drag/resize session: table + element geometry (ADMIN, MANAGER)",
  })
  @ApiResponse({ status: 200, description: "Counts of rows updated" })
  @ApiResponse({
    status: 404,
    description:
      "A target zone, table, or element is not in this branch — nothing was saved",
  })
  saveLayout(@Body() dto: SaveLayoutDto, @CurrentScope() scope: BranchScope) {
    return this.floorPlan.saveLayout(scope, dto);
  }
}
