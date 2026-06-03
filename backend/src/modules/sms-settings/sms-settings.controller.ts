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
import { SmsSettingsService } from "./sms-settings.service";
import { UpdateSmsSettingsDto } from "./dto/update-sms-settings.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { PlanFeatureGuard } from "../subscriptions/guards/plan-feature.guard";
import { RequiresIntegration } from "../subscriptions/decorators/requires-integration.decorator";

// v2.8.90 — SMS credential surface gated on integration. Provider
// credentials (Netgsm API key, Twilio SID/token) are PII + money flow;
// tenants without an `integration_sms` add-on (or plan that bundles
// SMS) shouldn't see vendor connect endpoints.
@ApiTags("sms-settings")
@ApiBearerAuth()
@Controller("sms-settings")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresIntegration("sms")
export class SmsSettingsController {
  constructor(private readonly smsSettingsService: SmsSettingsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Get SMS notification settings for current tenant" })
  @ApiResponse({
    status: 200,
    description: "SMS settings retrieved successfully",
  })
  findByTenant(@Request() req) {
    return this.smsSettingsService.findByTenant(req.tenantId);
  }

  @Patch()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Update SMS notification settings" })
  @ApiResponse({
    status: 200,
    description: "SMS settings updated successfully",
  })
  update(@Request() req, @Body() updateDto: UpdateSmsSettingsDto) {
    return this.smsSettingsService.update(req.tenantId, updateDto);
  }
}
