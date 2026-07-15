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
  Query,
  ParseUUIDPipe,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { TablesService } from "./tables.service";
import { CreateTableDto } from "./dto/create-table.dto";
import { UpdateTableDto } from "./dto/update-table.dto";
import { UpdateTableStatusDto } from "./dto/update-table-status.dto";
import { MergeTablesDto, UnmergeTableDto } from "./dto/merge-tables.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { PlanFeatureGuard } from "../subscriptions/guards/plan-feature.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { Public } from "../auth/decorators/public.decorator";
import { CurrentScope } from "../auth/decorators/current-scope.decorator";
import { SkipBranchScope } from "../auth/decorators/skip-branch-scope.decorator";
import { BranchScope } from "../../common/scoping/branch-scope";
import {
  CheckLimit,
  LimitType,
} from "../subscriptions/decorators/check-limit.decorator";
import { UserRole } from "../../common/constants/roles.enum";

@ApiTags("tables")
@ApiBearerAuth()
@Controller("tables")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @CheckLimit(LimitType.TABLES)
  @ApiOperation({ summary: "Create a new table (ADMIN, MANAGER)" })
  @ApiResponse({ status: 201, description: "Table successfully created" })
  @ApiResponse({ status: 409, description: "Table number already exists" })
  @ApiResponse({ status: 403, description: "Insufficient permissions" })
  create(
    @Body() createTableDto: CreateTableDto,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.tablesService.create(scope, createTableDto);
  }

  // ========================================
  // TABLE MERGE / SPLIT (static routes BEFORE :id wildcard)
  // ========================================

  @Post("merge")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "Merge tables into a group" })
  @ApiResponse({ status: 200, description: "Tables merged successfully" })
  mergeTables(@Body() dto: MergeTablesDto, @CurrentScope() scope: BranchScope) {
    return this.tablesService.mergeTables(scope, dto);
  }

  @Post("unmerge")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "Remove a table from its group" })
  @ApiResponse({ status: 200, description: "Table unmerged successfully" })
  unmergeTable(
    @Body() dto: UnmergeTableDto,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.tablesService.unmergeTable(scope, dto);
  }

  @Post("unmerge-all/:groupId")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "Dissolve an entire table group" })
  @ApiResponse({ status: 200, description: "All tables unmerged" })
  unmergeAll(
    @Param("groupId", new ParseUUIDPipe()) groupId: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.tablesService.unmergeAll(scope, groupId);
  }

  @Get("group/:groupId")
  @ApiOperation({ summary: "Get all tables and orders in a group" })
  @ApiResponse({ status: 200, description: "Table group details with orders" })
  getTableGroup(
    @Param("groupId", new ParseUUIDPipe()) groupId: string,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.tablesService.getTableGroup(scope, groupId);
  }

  // ========================================
  // STANDARD TABLE CRUD
  // ========================================

  @Get()
  @ApiOperation({ summary: "Get all tables" })
  @ApiQuery({
    name: "section",
    required: false,
    description: "Filter by section",
  })
  @ApiResponse({ status: 200, description: "List of all tables" })
  findAll(
    @CurrentScope() scope: BranchScope,
    @Query("section") section?: string,
  ) {
    return this.tablesService.findAll(scope, section);
  }

  // Public customer-facing table listing — no auth, no scope. The
  // SkipBranchScope annotation pairs with @Public(); BranchGuard never
  // touches public routes but the lint rule needs the explicit marker.
  @Public()
  @SkipBranchScope()
  // NAT-aware limit: customers share the venue WiFi's single IP, so this
  // read/poll cap is sized for a BUSY venue's whole clientele, not one user.
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  @Get("public/:tenantId")
  @ApiOperation({
    summary: "Get available tables for customer selection (no auth required)",
  })
  @ApiQuery({
    name: "branchId",
    required: false,
    description:
      "Branch to list tables for; defaults to the tenant's oldest-active branch",
  })
  @ApiResponse({
    status: 200,
    description: "List of available tables for customers",
  })
  getPublicTables(
    @Param("tenantId") tenantId: string,
    @Query("branchId") branchId?: string,
  ) {
    // Anonymous read — no @CurrentScope. The optional branchId narrows
    // the listing to one branch; the service validates it belongs to the
    // tenant (else oldest-active fallback) so a guest can't enumerate or
    // mix in another tenant's / archived branch's tables.
    return this.tablesService.findAvailableForCustomers(tenantId, branchId);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a table by ID" })
  @ApiResponse({ status: 200, description: "Table details with active orders" })
  @ApiResponse({ status: 404, description: "Table not found" })
  findOne(@Param("id") id: string, @CurrentScope() scope: BranchScope) {
    return this.tablesService.findOne(scope, id);
  }

  @Patch(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Update a table (ADMIN, MANAGER)" })
  @ApiResponse({ status: 200, description: "Table successfully updated" })
  @ApiResponse({ status: 404, description: "Table not found" })
  @ApiResponse({ status: 409, description: "Table number already exists" })
  @ApiResponse({ status: 403, description: "Insufficient permissions" })
  update(
    @Param("id") id: string,
    @Body() updateTableDto: UpdateTableDto,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.tablesService.update(scope, id, updateTableDto);
  }

  @Patch(":id/status")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({ summary: "Update table status (ADMIN, MANAGER, WAITER)" })
  @ApiResponse({
    status: 200,
    description: "Table status successfully updated",
  })
  @ApiResponse({ status: 404, description: "Table not found" })
  @ApiResponse({ status: 403, description: "Insufficient permissions" })
  updateStatus(
    @Param("id") id: string,
    @Body() updateStatusDto: UpdateTableStatusDto,
    @CurrentScope() scope: BranchScope,
  ) {
    return this.tablesService.updateStatus(scope, id, updateStatusDto);
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Delete a table (ADMIN, MANAGER)" })
  @ApiResponse({ status: 200, description: "Table successfully deleted" })
  @ApiResponse({ status: 404, description: "Table not found" })
  @ApiResponse({ status: 409, description: "Table has active orders" })
  @ApiResponse({ status: 403, description: "Insufficient permissions" })
  remove(@Param("id") id: string, @CurrentScope() scope: BranchScope) {
    return this.tablesService.remove(scope, id);
  }
}
