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
  constructor(private readonly media: ProductMediaService) {}

  @Get("status")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Whether fal.ai media generation is configured" })
  status() {
    return { configured: this.media.isConfigured() };
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Media + in-flight job status for a product" })
  get(@Param("id") id: string, @Request() req) {
    return this.media.getStatus(id, req.tenantId);
  }

  @Post(":id/generate-photo")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
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
  @ApiOperation({ summary: "Generate the ingredients video (async job)" })
  generateVideo(
    @Param("id") id: string,
    @Body() body: GenerateVideoDto,
    @Request() req,
  ) {
    return this.media.generateIngredientsVideo(id, req.tenantId, body);
  }

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
