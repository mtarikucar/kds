import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { BranchesService } from "./branches.service";
import { CreateBranchDto, UpdateBranchDto } from "./dto/branch.dto";
import { PlanFeatureGuard } from "../subscriptions/guards/plan-feature.guard";
import { RequiresFeature } from "../subscriptions/decorators/requires-feature.decorator";
import {
  CheckLimit,
  LimitType,
} from "../subscriptions/decorators/check-limit.decorator";
import { PlanFeature } from "../../common/constants/subscription.enum";
import { SkipBranchScope } from "../auth/decorators/skip-branch-scope.decorator";
import { HARD_RESTRICTED_ROLES } from "../../common/constants/roles.enum";
import { PrismaService } from "../../prisma/prisma.service";

@ApiTags("Branches")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
@SkipBranchScope()
@Controller("v1/branches")
export class BranchesController {
  constructor(
    private readonly branches: BranchesService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * v3.0.0 — visible-branches endpoint.
   *
   * Every authenticated role (including WAITER/KITCHEN/COURIER) can
   * call this to discover the branches their BranchPicker / locked
   * badge should render. The list is server-filtered by the user's
   * role:
   *   - WAITER/KITCHEN/COURIER → exactly one entry (primaryBranchId).
   *   - MANAGER → the resolved UserBranchAssignment allow-list.
   *   - ADMIN  → every active branch in the tenant (wildcard owner).
   *
   * Distinct from `/v1/branches` (CRUD), which stays ADMIN/MANAGER-
   * only. Pre-v3 hard-restricted roles got a 403 trying to call list()
   * and the BranchPicker had nothing to render.
   */
  @Get("visible")
  async visible(@Req() req: any) {
    const user = req.user;
    const role = user.role as string;
    if (HARD_RESTRICTED_ROLES.includes(role as any)) {
      // The DB CHECK constraint guarantees primaryBranchId is set
      // for these roles — refusing here would be a server bug.
      if (!user.primaryBranchId) return [];
      const branch = await this.prisma.branch.findFirst({
        where: {
          id: user.primaryBranchId,
          tenantId: user.tenantId,
          status: "active",
        },
        select: { id: true, name: true, address: true, status: true },
      });
      return branch ? [branch] : [];
    }
    if (role === UserRole.MANAGER) {
      return this.prisma.branch.findMany({
        where: {
          tenantId: user.tenantId,
          status: "active",
          id: { in: user.allowedBranchIds ?? [] },
        },
        select: { id: true, name: true, address: true, status: true },
        orderBy: { createdAt: "asc" },
      });
    }
    // ADMIN — empty allow-list = wildcard.
    return this.prisma.branch.findMany({
      where: { tenantId: user.tenantId, status: "active" },
      select: { id: true, name: true, address: true, status: true },
      orderBy: { createdAt: "asc" },
    });
  }

  // v2.8.91: ADMIN/MANAGER only on list + detail. Pre-v2.8.91 the
  // class-level guard chain lacked any @Roles on list/detail — every
  // authenticated role could enumerate branches. WAITER needs the
  // branch dropdown when assigning orders so they still see "their"
  // branch via a different surface (POSPage reads it from auth context);
  // the management-style list is admin scope.
  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  list(@Req() req: any) {
    return this.branches.list(req.user.tenantId);
  }

  // Branch hub overview — every branch (Merkez/HQ first) with live device
  // tallies + bridge counts in one call. NOT feature-gated: a single-location
  // tenant manages its devices here too (this hub replaces the old flat
  // Devices/Bridges pages, which had no plan gate). MUST be declared before
  // the `:id` route so "overview" isn't captured as a branch id.
  @Get("overview")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Branch hub: branches + device/bridge tallies" })
  overview(@Req() req: any) {
    return this.branches.overview(req.user.tenantId, {
      role: req.user.role,
      primaryBranchId: req.user.primaryBranchId ?? null,
      allowedBranchIds: req.user.allowedBranchIds ?? [],
    });
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  one(@Req() req: any, @Param("id") id: string) {
    return this.branches.findOrThrow(req.user.tenantId, id);
  }

  // A branch's local-network topology: bridges + devices behind each +
  // cloud-direct devices ("şube içi ağ"). ADMIN/MANAGER, tenant-scoped.
  @Get(":id/network")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "Branch local-network topology (bridges + devices)",
  })
  network(@Req() req: any, @Param("id") id: string) {
    return this.branches.network(req.user.tenantId, id, {
      role: req.user.role,
      primaryBranchId: req.user.primaryBranchId ?? null,
      allowedBranchIds: req.user.allowedBranchIds ?? [],
    });
  }

  // Create / update / archive are ADMIN-only AND require the
  // MULTI_LOCATION feature (v2.8.88). Pre-v2.8.88 a FREE-plan tenant
  // could spin up unlimited branches via POST — the plan limit
  // (`maxBranches: 1`) was implicit and unenforced. The feature gate
  // routes through the engine, so an `extra_branch` add-on or PRO+
  // plan unlocks. Reads stay open for everyone (staff need to see
  // which branches exist to route orders).
  //
  // v3.0.0 — @CheckLimit(BRANCHES) also enforces the numeric cap
  // (FREE/BASIC=1, PRO=3, BUSINESS=-1). MULTI_LOCATION feature gate
  // fires first; tenants without it never reach the count check.
  // Tenants with MULTI_LOCATION still bounce off the cap once the
  // count of active branches reaches the engine-resolved limit
  // (plan + extra_branch add-on grants summed).
  @Post()
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.MULTI_LOCATION)
  @CheckLimit(LimitType.BRANCHES)
  @ApiOperation({
    summary: "Create a new branch (ADMIN only, MULTI_LOCATION feature)",
  })
  create(@Req() req: any, @Body() body: CreateBranchDto) {
    return this.branches.create(req.user.tenantId, body);
  }

  @Patch(":id")
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.MULTI_LOCATION)
  update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: UpdateBranchDto,
  ) {
    return this.branches.update(req.user.tenantId, id, body);
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.MULTI_LOCATION)
  archive(@Req() req: any, @Param("id") id: string) {
    return this.branches.archive(req.user.tenantId, id);
  }
}
