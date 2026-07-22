import {
  Body,
  Controller,
  Get,
  Post,
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
import { SkipBranchScope } from "../../auth/decorators/skip-branch-scope.decorator";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";
import { RequiresIntegration } from "../../subscriptions/decorators/requires-integration.decorator";
import { DeliveryLogService } from "../services/delivery-log.service";

interface RequeueBody {
  ids: string[];
  resetAttempts?: boolean;
}

/**
 * Read + replay surface for the delivery-platforms dead-letter queue.
 *
 * A delivery log row whose retries are exhausted lands in
 * `success:false AND nextRetryAt:null AND retryCount>=maxRetries`. The
 * RetryScheduler's getFailedOperations() filters `nextRetryAt <= now`, so a
 * null-nextRetryAt row is never re-claimed — it sits dead until an operator
 * acts. Mirrors SuperAdminOutboxController (list / summary / requeue, 100-id
 * cap), but tenant-scoped: an ADMIN/MANAGER triages their own tenant's
 * failures. The view is intentionally tenant-wide across branches (matching
 * the existing /delivery-platforms/logs semantics), hence @SkipBranchScope().
 */
// DEF-3: same @RequiresIntegration('delivery') gate as DeliveryPlatformsController
// — see that controller's comment for the full rationale.
@ApiTags("delivery-platforms/dlq")
@ApiBearerAuth()
@Controller("delivery-platforms/dlq")
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard, PlanFeatureGuard)
@RequiresIntegration("delivery")
export class DeliveryDlqController {
  constructor(private readonly logService: DeliveryLogService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @SkipBranchScope()
  @ApiOperation({
    summary: "List delivery log rows that exhausted retries (DLQ readout)",
  })
  list(
    @Request() req: any,
    @Query("platform") platform?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.logService.getDeadLetters({
      tenantId: req.user.tenantId,
      platform: platform?.toUpperCase(),
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
  }

  @Get("summary")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @SkipBranchScope()
  @ApiOperation({ summary: "Depth of the delivery dead-letter queue" })
  async summary(@Request() req: any, @Query("platform") platform?: string) {
    const depth = await this.logService.dlqDepth({
      tenantId: req.user.tenantId,
      platform: platform?.toUpperCase(),
    });
    return { depth };
  }

  @Post("requeue")
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @SkipBranchScope()
  @ApiOperation({
    summary:
      "Re-queue dead-lettered rows (nextRetryAt=now) for the RetryScheduler",
  })
  requeue(@Request() req: any, @Body() body: RequeueBody) {
    return this.logService.requeueDeadLetters(body?.ids ?? [], {
      resetAttempts: body?.resetAttempts,
      tenantId: req.user.tenantId,
    });
  }
}
