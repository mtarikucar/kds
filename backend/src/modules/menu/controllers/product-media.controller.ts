import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ProductMediaService } from "../services/product-media.service";
import { MenuAiQuotaService } from "../services/menu-ai-quota.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { UserRole } from "../../../common/constants/roles.enum";
import {
  GenerateFrameDto,
  GeneratePhotoDto,
  GenerateVideoDto,
  SetPrimaryImageDto,
} from "../dto/product-media.dto";

@ApiTags("product-media")
@Controller("menu/product-media")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
export class ProductMediaController {
  constructor(
    private readonly media: ProductMediaService,
    private readonly quota: MenuAiQuotaService,
  ) {}

  // Deliberately NOT feature-gated: the panel reads this to render the
  // locked/upsell state for plans without AI, so a 403 here would blank it.
  @Get("status")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "fal.ai config + the tenant's monthly AI quota usage",
  })
  async status(@Request() req) {
    const [photos, videos] = await Promise.all([
      this.quota.getUsage(req.tenantId, "PHOTO"),
      this.quota.getUsage(req.tenantId, "VIDEO"),
    ]);
    return { configured: this.media.isConfigured(), photos, videos };
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Media + in-flight job status for a product" })
  get(@Param("id") id: string, @Request() req) {
    return this.media.getStatus(id, req.tenantId);
  }

  @Post(":id/generate-photo")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.AI_CONTENT_GENERATION)
  @ApiOperation({ summary: "Generate dish photo variations (async job)" })
  generatePhoto(
    @Param("id") id: string,
    @Body() body: GeneratePhotoDto,
    @Request() req,
  ) {
    return this.media.generatePhoto(id, req.tenantId, body);
  }

  @Post(":id/generate-frame")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.AI_CONTENT_GENERATION)
  @ApiOperation({
    summary: "Generate ingredients last-frame variations (async job)",
  })
  generateFrame(
    @Param("id") id: string,
    @Body() body: GenerateFrameDto,
    @Request() req,
  ) {
    return this.media.generateIngredientsFrame(id, req.tenantId, body);
  }

  @Post(":id/generate-video")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @RequiresFeature(PlanFeature.AI_CONTENT_GENERATION)
  @ApiOperation({ summary: "Generate the ingredients video (async job)" })
  generateVideo(
    @Param("id") id: string,
    @Body() body: GenerateVideoDto,
    @Request() req,
  ) {
    return this.media.generateIngredientsVideo(id, req.tenantId, body);
  }

  // Not feature-gated: picking a primary from ALREADY-generated images costs
  // nothing and must keep working after a downgrade.
  @Post(":id/set-primary-image")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Make a library image the product's primary photo" })
  setPrimary(
    @Param("id") id: string,
    @Body() body: SetPrimaryImageDto,
    @Request() req,
  ) {
    return this.media.setPrimaryImage(id, req.tenantId, body.imageUrl);
  }
}
