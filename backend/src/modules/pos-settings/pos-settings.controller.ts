import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from "@nestjs/swagger";
import { PosSettingsService } from "./pos-settings.service";
import { UpdatePosSettingsDto } from "./dto/update-pos-settings.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { PlanFeatureGuard } from "../subscriptions/guards/plan-feature.guard";
import { RequiresFeature } from "../subscriptions/decorators/requires-feature.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { PlanFeature } from "../../common/constants/subscription.enum";
import { SkipBranchScope } from "../auth/decorators/skip-branch-scope.decorator";

// v3.0.0 — POS settings are gated on `feature.posAccess`. FREE plans
// (post-trial fallback) lose access to both GET and PATCH; the engine
// returns 403 with "feature not available in your current plan", and
// the frontend <FeatureGate feature="posAccess"> renders an UpsellCard
// pointing at BASIC. The gate also catches API consumers bypassing the
// React app.
//
// SkipBranchScope: POS settings are tenant-wide (every branch shares
// the same POS configuration). The new lint rule
// `controller-needs-scope-or-skip` would flag the bare handlers without
// this annotation.
@ApiTags("pos-settings")
@ApiBearerAuth()
@Controller("pos-settings")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.POS_ACCESS)
@SkipBranchScope()
export class PosSettingsController {
  constructor(private readonly posSettingsService: PosSettingsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER)
  @ApiOperation({
    summary: "Get POS settings for current tenant (ADMIN, MANAGER, WAITER)",
  })
  @ApiResponse({
    status: 200,
    description: "POS settings retrieved successfully",
  })
  @ApiResponse({
    status: 403,
    description: "POS access not available on current plan",
  })
  findByTenant(@Request() req) {
    return this.posSettingsService.findByTenant(req.tenantId);
  }

  @Patch()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Update POS settings (ADMIN, MANAGER)" })
  @ApiResponse({
    status: 200,
    description: "POS settings updated successfully",
  })
  @ApiResponse({
    status: 403,
    description: "POS access not available on current plan",
  })
  update(@Request() req, @Body() updateDto: UpdatePosSettingsDto) {
    return this.posSettingsService.update(req.tenantId, updateDto);
  }
}
