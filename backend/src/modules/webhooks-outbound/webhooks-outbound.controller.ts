import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { PlanFeatureGuard } from "../subscriptions/guards/plan-feature.guard";
import { RequiresFeature } from "../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../common/constants/subscription.enum";
import { WebhookOutboundService } from "./webhook-outbound.service";

// v2.8.88: outbound webhook subscriptions are an API-power feature
// (BUSINESS plan or `api_access` add-on). Pre-v2.8.88 any authenticated
// tenant user could create / list / revoke their webhook subscriptions
// — a privilege gap since webhooks emit tenant data to arbitrary URLs.
@ApiTags("Webhooks · Outbound")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
@Roles(UserRole.ADMIN)
@RequiresFeature(PlanFeature.API_ACCESS)
@Controller("v1/webhooks/subscriptions")
export class WebhooksOutboundController {
  constructor(private readonly svc: WebhookOutboundService) {}

  @Get()
  list(@Req() req: any) {
    return this.svc.list(req.user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: "Subscribe to events. Secret is returned ONCE." })
  subscribe(@Req() req: any, @Body() body: { url: string; events?: string[] }) {
    return this.svc.subscribe(req.user.tenantId, body);
  }

  @Delete(":id")
  revoke(@Req() req: any, @Param("id") id: string) {
    return this.svc.revoke(req.user.tenantId, id);
  }
}
