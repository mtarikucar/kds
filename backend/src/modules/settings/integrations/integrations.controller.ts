import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from "@nestjs/swagger";
import { IntegrationsService } from "./integrations.service";
import { CreateIntegrationDto } from "./dto/create-integration.dto";
import { UpdateIntegrationDto } from "./dto/update-integration.dto";
import {
  ReportDeviceEventDto,
  ToggleIntegrationStatusDto,
  UpdateDeviceStatusDto,
} from "./dto/hardware-ops.dto";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { PlanFeature } from "../../../common/constants/subscription.enum";

@ApiTags("settings/integrations")
@ApiBearerAuth()
@Controller("admin/settings/integrations")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresFeature(PlanFeature.API_ACCESS)
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Get all integrations for tenant" })
  @ApiResponse({
    status: 200,
    description: "Integrations retrieved successfully",
  })
  findAll(@Request() req, @Query("type") type?: string) {
    if (type) {
      return this.integrationsService.findByType(req.tenantId, type);
    }
    return this.integrationsService.findAll(req.tenantId);
  }

  @Get(":id")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Get integration by ID" })
  @ApiResponse({
    status: 200,
    description: "Integration retrieved successfully",
  })
  @ApiResponse({ status: 404, description: "Integration not found" })
  findOne(@Request() req, @Param("id") id: string) {
    return this.integrationsService.findOne(id, req.tenantId);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Create new integration (ADMIN only)" })
  @ApiResponse({ status: 201, description: "Integration created successfully" })
  @ApiResponse({ status: 409, description: "Integration already exists" })
  create(@Request() req, @Body() createDto: CreateIntegrationDto) {
    return this.integrationsService.create(req.tenantId, createDto);
  }

  @Patch(":id")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Update integration (ADMIN only)" })
  @ApiResponse({ status: 200, description: "Integration updated successfully" })
  @ApiResponse({ status: 404, description: "Integration not found" })
  update(
    @Request() req,
    @Param("id") id: string,
    @Body() updateDto: UpdateIntegrationDto,
  ) {
    return this.integrationsService.update(id, req.tenantId, updateDto);
  }

  @Delete(":id")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Delete integration (ADMIN only)" })
  @ApiResponse({ status: 200, description: "Integration deleted successfully" })
  @ApiResponse({ status: 404, description: "Integration not found" })
  delete(@Request() req, @Param("id") id: string) {
    return this.integrationsService.delete(id, req.tenantId);
  }

  @Patch(":id/toggle")
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Toggle integration status (ADMIN only)" })
  @ApiResponse({
    status: 200,
    description: "Integration status toggled successfully",
  })
  toggleStatus(
    @Request() req,
    @Param("id") id: string,
    @Body() body: ToggleIntegrationStatusDto,
  ) {
    return this.integrationsService.toggleStatus(
      id,
      req.tenantId,
      body.isEnabled,
    );
  }

  @Post(":id/sync")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: "Request a sync for an integration",
    description:
      "HONEST behavior: credential integrations (payment/CRM/accounting/" +
      "delivery/third-party) have no live adapter wired yet, so this does " +
      "NOT stamp a success timestamp. It returns { synced: false } with the " +
      "integration's real activation state instead of pretending a sync ran.",
  })
  @ApiResponse({
    status: 200,
    description:
      "Sync request result. synced=false until a real adapter is wired.",
  })
  requestSync(@Request() req, @Param("id") id: string) {
    return this.integrationsService.requestSync(id, req.tenantId);
  }
}

// v2.8.91 — drop the `api/` prefix from @Controller. The global
// setGlobalPrefix('api') already adds it, so prior decoration produced
// `/api/api/hardware/config` instead of `/api/hardware/config`. Tauri
// desktop app and any docs/links must use the corrected path.
@ApiTags("hardware")
@ApiBearerAuth()
@Controller("hardware")
@UseGuards(JwtAuthGuard, TenantGuard)
export class HardwareConfigController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get("config")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN)
  @ApiOperation({
    summary: "Get hardware device configurations for desktop app",
  })
  @ApiResponse({
    status: 200,
    description: "Hardware configurations retrieved successfully",
  })
  async getHardwareConfig(@Request() req) {
    return this.integrationsService.getHardwareConfig(req.tenantId);
  }

  @Post("devices/:deviceId/status")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN)
  @ApiOperation({ summary: "Update device status from desktop app" })
  @ApiResponse({
    status: 200,
    description: "Device status updated successfully",
  })
  async updateDeviceStatus(
    @Request() req,
    @Param("deviceId") deviceId: string,
    @Body() body: UpdateDeviceStatusDto,
  ) {
    return this.integrationsService.updateDeviceStatus(
      deviceId,
      req.tenantId,
      body.status,
    );
  }

  @Post("devices/:deviceId/events")
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN)
  @ApiOperation({ summary: "Report hardware event from desktop app" })
  @ApiResponse({ status: 200, description: "Event reported successfully" })
  async reportDeviceEvent(
    @Request() req,
    @Param("deviceId") deviceId: string,
    @Body() body: ReportDeviceEventDto,
  ) {
    return this.integrationsService.reportDeviceEvent(
      deviceId,
      req.tenantId,
      body,
    );
  }
}
