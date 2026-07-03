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
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";

@ApiTags("product-media")
@Controller("menu/product-media")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
export class ProductMediaController {
  constructor(private readonly media: ProductMediaService) {}

  @Get("status")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Whether fal.ai media generation is configured" })
  status() {
    return { configured: this.media.isConfigured() };
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Generated-media status for a product (read-only)" })
  get(@Param("id") id: string, @Request() req) {
    return this.media.getStatus(id, req.tenantId);
  }

  @Post(":id/generate-photo")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "Auto-generate a product photo (fal.ai text-to-image)",
  })
  generatePhoto(
    @Param("id") id: string,
    @Body() body: { prompt?: string },
    @Request() req,
  ) {
    return this.media.generatePhoto(id, req.tenantId, body?.prompt);
  }

  @Post(":id/generate-video")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "Generate an ingredients video (dish photo → ingredients-on-table transition)",
  })
  generateVideo(@Param("id") id: string, @Request() req) {
    return this.media.generateIngredientsVideo(id, req.tenantId);
  }
}
