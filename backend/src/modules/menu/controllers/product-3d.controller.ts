import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Product3dService } from "../services/product-3d.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { UserRole } from "../../../common/constants/roles.enum";

@ApiTags("product-3d")
@Controller("menu/product-3d")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
export class Product3dController {
  constructor(private readonly product3d: Product3dService) {}

  /** Lets the product editor show/hide the "generate 3D" action. */
  @Get("status")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Whether Meshy 3D generation is configured" })
  status() {
    return { configured: this.product3d.isConfigured() };
  }

  @Post(":id/generate")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  // AI studio is PRO+ (feature-flag only — Meshy generations are idempotent
  // per product, so no monthly cap; photo/video quotas don't apply here).
  @RequiresFeature(PlanFeature.AI_CONTENT_GENERATION)
  @ApiOperation({ summary: "Start 3D-model generation from a product's photo" })
  generate(
    @Param("id") id: string,
    @Query("force") force: string,
    @Request() req,
  ) {
    return this.product3d.requestModel(id, req.tenantId, force === "true");
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "Current 3D-model status for a product (read-only)",
  })
  get(@Param("id") id: string, @Request() req) {
    return this.product3d.getStatus(id, req.tenantId);
  }
}
