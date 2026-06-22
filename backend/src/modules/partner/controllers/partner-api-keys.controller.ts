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
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { Roles } from "../../auth/decorators/roles.decorator";
import { UserRole } from "../../../common/constants/roles.enum";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { RequiresFeature } from "../../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../../common/constants/subscription.enum";
import { SkipBranchScope } from "../../auth/decorators/skip-branch-scope.decorator";
import { PartnerApiKeyService } from "../partner-api-key.service";
import { CreateApiKeyDto } from "../dto/create-api-key.dto";
import { PARTNER_SCOPES } from "../partner.constants";

/**
 * Tenant ADMIN management of Partner Display API keys. Gated on the
 * EXTERNAL_DISPLAY plan feature (mirrors webhooks-outbound's API_ACCESS gate).
 * Tenant-level resource — all handlers scope by req.user.tenantId and the
 * controller is @SkipBranchScope (the frontend treats /v1/partner as
 * tenant-wide and omits X-Branch-Id).
 */
@ApiTags("Partner · API Keys")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
@Roles(UserRole.ADMIN)
@RequiresFeature(PlanFeature.EXTERNAL_DISPLAY)
@SkipBranchScope()
@Controller("v1/partner/api-keys")
export class PartnerApiKeysController {
  constructor(private readonly svc: PartnerApiKeyService) {}

  @Get()
  @ApiOperation({ summary: "List this tenant's partner API keys" })
  list(@Req() req: any) {
    return this.svc.list(req.user.tenantId);
  }

  @Post()
  @ApiOperation({ summary: "Create a partner API key. Secret returned ONCE." })
  issue(@Req() req: any, @Body() dto: CreateApiKeyDto) {
    return this.svc.issue(
      req.user.tenantId,
      req.user?.id ?? req.user?.sub ?? null,
      {
        name: dto.name,
        scopes: dto.scopes ?? [...PARTNER_SCOPES],
        allowedReturnOrigins: dto.allowedReturnOrigins,
        allowedBranchIds: dto.allowedBranchIds,
      },
    );
  }

  @Delete(":id")
  @ApiOperation({ summary: "Revoke a key (cascades to its screen sessions)" })
  revoke(@Req() req: any, @Param("id") id: string) {
    return this.svc.revoke(req.user.tenantId, id);
  }
}
