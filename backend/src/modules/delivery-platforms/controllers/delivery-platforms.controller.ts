import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { RequiresIntegration } from "../../subscriptions/decorators/requires-integration.decorator";
import { DeliveryConfigService } from "../services/delivery-config.service";
import { DeliveryLogService } from "../services/delivery-log.service";
import { DeliveryMenuSyncService } from "../services/delivery-menu-sync.service";
import { DeliveryTestService } from "../services/delivery-test.service";
import { DeliveryModerationService } from "../services/delivery-moderation.service";
import { CreatePlatformConfigDto } from "../dto/create-platform-config.dto";
import { UpdatePlatformConfigDto } from "../dto/update-platform-config.dto";

// DEF-3: gate on the integration domain, not the plan feature directly.
// PlanFeatureGuard's @RequiresIntegration branch accepts EITHER a bought
// delivery add-on (integration.delivery=[vendor]) OR a plan that already
// includes delivery (feature.deliveryIntegration=true, via
// INTEGRATION_COVERED_BY_FEATURE) — so a BASIC tenant who buys
// delivery_yemeksepeti/getir/trendyol_yemek actually unlocks this
// controller, which @RequiresFeature(DELIVERY_INTEGRATION) alone never did
// (the add-on grants integration.delivery, not feature.deliveryIntegration).
@ApiTags("delivery-platforms")
@ApiBearerAuth()
@Controller("delivery-platforms")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresIntegration("delivery")
export class DeliveryPlatformsController {
  constructor(
    private readonly configService: DeliveryConfigService,
    private readonly logService: DeliveryLogService,
    private readonly menuSyncService: DeliveryMenuSyncService,
    private readonly testService: DeliveryTestService,
    private readonly moderationService: DeliveryModerationService,
  ) {}

  // ========================================
  // Platform Configuration CRUD
  // ========================================

  @Get("configs")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findAllConfigs(@Request() req: any) {
    return this.configService.findAll(req.user.tenantId);
  }

  @Get("configs/:platform")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  findOneConfig(@Request() req: any, @Param("platform") platform: string) {
    return this.configService.findOne(
      req.user.tenantId,
      platform.toUpperCase(),
    );
  }

  @Post("configs")
  @Roles(UserRole.ADMIN)
  createConfig(@Request() req: any, @Body() dto: CreatePlatformConfigDto) {
    return this.configService.create(req.user.tenantId, dto);
  }

  @Patch("configs/:platform")
  @Roles(UserRole.ADMIN)
  updateConfig(
    @Request() req: any,
    @Param("platform") platform: string,
    @Body() dto: UpdatePlatformConfigDto,
  ) {
    return this.configService.update(
      req.user.tenantId,
      platform.toUpperCase(),
      dto,
    );
  }

  @Delete("configs/:platform")
  @Roles(UserRole.ADMIN)
  deleteConfig(@Request() req: any, @Param("platform") platform: string) {
    return this.configService.delete(req.user.tenantId, platform.toUpperCase());
  }

  // ========================================
  // Platform Actions
  // ========================================

  @Post("configs/:platform/test")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  async testConnection(
    @Request() req: any,
    @Param("platform") platform: string,
  ) {
    const success = await this.configService.testConnection(
      req.user.tenantId,
      platform.toUpperCase(),
    );
    return { success };
  }

  @Post("test-order/:platform")
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary:
      "Fire a synthetic TEST order through the real ingest pipeline (sandbox-only)",
  })
  async createTestOrder(
    @Request() req: any,
    @Param("platform") platform: string,
  ) {
    const order = await this.testService.simulateOrder(
      req.user.tenantId,
      platform.toUpperCase(),
    );
    return {
      simulated: true,
      orderId: order?.id ?? null,
      orderNumber: order?.orderNumber ?? null,
      externalOrderId: order?.externalOrderId ?? null,
      status: order?.status ?? null,
    };
  }

  @Post("configs/:platform/toggle-restaurant")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  toggleRestaurant(
    @Request() req: any,
    @Param("platform") platform: string,
    @Body("open") open: boolean,
  ) {
    return this.configService.toggleRestaurant(
      req.user.tenantId,
      platform.toUpperCase(),
      open,
    );
  }

  // ========================================
  // Order Moderation (operator ACCEPT / REJECT / set PREP-TIME)
  // ========================================

  @Post("orders/:orderId/accept")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "Accept an incoming delivery-platform order (optionally with a prep time)",
  })
  acceptOrder(
    @Request() req: any,
    @Param("orderId") orderId: string,
    @Body("prepTimeMinutes") prepTimeMinutes?: number,
  ) {
    return this.moderationService.acceptOrder(
      req.user.tenantId,
      orderId,
      prepTimeMinutes,
    );
  }

  @Post("orders/:orderId/reject")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "Reject an incoming delivery-platform order; the reason is sent to the platform",
  })
  rejectOrder(
    @Request() req: any,
    @Param("orderId") orderId: string,
    @Body("reason") reason: string,
  ) {
    return this.moderationService.rejectOrder(
      req.user.tenantId,
      orderId,
      reason,
    );
  }

  @Post("orders/:orderId/prep-time")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      "Set the kitchen prep time for an accepted delivery-platform order (marks it preparing on the platform)",
  })
  setPrepTime(
    @Request() req: any,
    @Param("orderId") orderId: string,
    @Body("minutes") minutes: number,
  ) {
    return this.moderationService.setPrepTime(
      req.user.tenantId,
      orderId,
      minutes,
    );
  }

  // ========================================
  // Logs
  // ========================================

  @Get("logs")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  getLogs(
    @Request() req: any,
    @Query("platform") platform?: string,
    @Query("success") success?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.logService.getLogs(req.user.tenantId, {
      platform: platform?.toUpperCase(),
      success: success !== undefined ? success === "true" : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  // ========================================
  // Menu Mappings
  // ========================================

  @Get("menu-mappings")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  getMappings(@Request() req: any, @Query("platform") platform?: string) {
    return this.menuSyncService.getMappings(
      req.user.tenantId,
      platform?.toUpperCase(),
    );
  }

  @Post("menu-mappings")
  @Roles(UserRole.ADMIN)
  createMapping(
    @Request() req: any,
    @Body()
    body: {
      productId: string;
      platform: string;
      externalItemId: string;
      externalData?: any;
    },
  ) {
    return this.menuSyncService.createMapping(
      req.user.tenantId,
      body.productId,
      body.platform.toUpperCase(),
      body.externalItemId,
      body.externalData,
    );
  }

  @Delete("menu-mappings/:id")
  @Roles(UserRole.ADMIN)
  deleteMapping(@Request() req: any, @Param("id") id: string) {
    return this.menuSyncService.deleteMapping(req.user.tenantId, id);
  }

  @Post("menu-sync/:platform")
  @Roles(UserRole.ADMIN)
  syncMenu(@Request() req: any, @Param("platform") platform: string) {
    return this.menuSyncService.syncMenuToPlatform(
      req.user.tenantId,
      platform.toUpperCase(),
    );
  }
}
