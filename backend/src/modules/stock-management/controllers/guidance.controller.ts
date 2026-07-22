import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import {
  GuidanceService,
  GuidanceResponse,
} from "../services/guidance.service";
import { CurrentScope } from "../../auth/decorators/current-scope.decorator";
import { BranchScope } from "../../../common/scoping/branch-scope";

const TTL_MS = 5 * 60 * 1000;

interface CachedGuidance {
  at: number;
  value: GuidanceResponse;
}

@ApiTags("stock-management/guidance")
@ApiBearerAuth()
@Controller("stock-management/guidance")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.INVENTORY_TRACKING)
export class GuidanceController {
  // Per-(tenant,branch) 5-minute cache — guidance is derived from up-to-180d
  // of PO history + slow-moving catalog/settings data, so it doesn't need to
  // be recomputed on every dashboard poll.
  private readonly cache = new Map<string, CachedGuidance>();

  constructor(private readonly guidance: GuidanceService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "Procurement guidance: par-based buy list + recommended supplier/channel per item",
  })
  async getGuidance(
    @CurrentScope() scope: BranchScope,
  ): Promise<GuidanceResponse> {
    const key = `${scope.tenantId}:${scope.branchId}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

    const value = await this.guidance.getGuidance(
      scope.tenantId,
      scope.branchId,
    );
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}
