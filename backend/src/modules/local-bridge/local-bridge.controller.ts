import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { BranchGuard } from "../auth/guards/branch.guard";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { Public } from "../auth/decorators/public.decorator";
import { LocalBridgeService } from "./local-bridge.service";
import { BridgeTokenGuard } from "./bridge-token.guard";
import { PlanFeatureGuard } from "../subscriptions/guards/plan-feature.guard";
import { RequiresFeature } from "../subscriptions/decorators/requires-feature.decorator";
import { PlanFeature } from "../../common/constants/subscription.enum";
import { CommandQueueService } from "../device-mesh/command-queue.service";
import { AckCommandDto } from "../device-mesh/dto/device.dto";
import {
  BridgeHeartbeatDto,
  ClaimBridgeDto,
  CreateBridgeSlotDto,
} from "./dto/local-bridge.dto";

@ApiTags("Local Bridge")
@Controller("v1/bridges")
export class LocalBridgeController {
  constructor(
    private readonly bridges: LocalBridgeService,
    private readonly queue: CommandQueueService,
  ) {}

  // -- Admin (user-auth) endpoints -----------------------------------------
  //
  // v2.8.88: ADMIN/MANAGER only. Pre-v2.8.88 any role could list and
  // any authenticated user could provision a bridge — bridges hold a
  // long-lived bearer token that talks to the tenant's POS/yazarkasa,
  // so privilege escalation here is high-impact.

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Get()
  list(@Req() req: any, @Query("branchId") branchId?: string) {
    // Branch-scope the bridge inventory (bridges hold a long-lived token to the
    // tenant's POS/yazarkasa, so cross-branch enumeration is high-impact). An
    // explicit ?branchId must be in the caller's allow-list; without one,
    // non-wildcard callers are confined to their allowed branches (wildcard
    // owner ADMIN — empty allow-list — still sees the whole tenant).
    const { role, primaryBranchId, allowedBranchIds } = req.user;
    const allowed: string[] = allowedBranchIds ?? [];
    const isWildcard = role === UserRole.ADMIN && allowed.length === 0;
    let branchFilter: { branchId?: string; branchIds?: string[] };
    if (branchId) {
      if (
        !BranchGuard.canAccessBranchStatic(
          role,
          branchId,
          primaryBranchId ?? null,
          allowed,
        )
      ) {
        throw new ForbiddenException("You do not have access to that branch");
      }
      branchFilter = { branchId };
    } else {
      branchFilter = isWildcard ? {} : { branchIds: allowed };
    }
    return this.bridges.list(req.user.tenantId, branchFilter);
  }

  // v2.8.90 — provisioning a bridge implies multi-branch ops (the sidebar
  // gates this entry on multiLocation). Pre-v2.8.90 the backend missed
  // the feature gate so direct URL hits worked on FREE plans.
  @UseGuards(JwtAuthGuard, RolesGuard, PlanFeatureGuard)
  @Roles(UserRole.ADMIN)
  @RequiresFeature(PlanFeature.MULTI_LOCATION)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({
    summary:
      "Provision a new bridge slot — returns provisioning token (shown once) (ADMIN only)",
  })
  createSlot(@Req() req: any, @Body() body: CreateBridgeSlotDto) {
    return this.bridges.createSlot(req.user.tenantId, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Delete(":id")
  retire(@Req() req: any, @Param("id") id: string) {
    return this.bridges.retire(req.user.tenantId, id);
  }

  // -- Bridge-side endpoints ----------------------------------------------

  @Public()
  // Defence in depth on top of iter-63's DTO length cap. /claim is the
  // only @Public endpoint here and the provisioning-token surface
  // hashes the full input via sha256; a tight 10/min-per-IP throttle
  // collapses any CPU-amplification window even if the DTO cap is
  // relaxed in a future refactor. A legitimate bridge claims exactly
  // once per provisioning.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("claim")
  @ApiOperation({
    summary:
      "Bridge exchanges provisioning token for a long-lived bearer token",
  })
  claim(@Body() body: ClaimBridgeDto) {
    return this.bridges.claim(body);
  }

  @UseGuards(BridgeTokenGuard)
  @Post("heartbeat")
  @ApiOperation({
    summary: "Bridge heartbeat. Auth: Authorization: Bridge <token>",
  })
  heartbeat(@Req() req: any, @Body() body: BridgeHeartbeatDto) {
    return this.bridges.heartbeat(req.bridge.id, body);
  }

  // -- Bridge command fan-in loop -----------------------------------------
  //
  // A bridge fronts multiple LAN devices that cannot self-poll (a closed Paygo
  // SP630 fiscal box, a dumb ESC/POS printer), so it pulls + acks commands on
  // their behalf. The queue is per-device; these two routes fan in across the
  // devices attached to THIS bridge (Device.bridgeId), scoped by the bridge
  // token so a bridge can only touch its own devices' commands. The pre-existing
  // per-device loop (/v1/devices/next-command + ack, DeviceTokenGuard) is
  // untouched — self-polling devices keep working exactly as before.
  //
  // Throttles mirror the device-mesh next-command/ack budget (~6× the agent's
  // 5s poll cadence) so a legitimate bridge sees daylight and a runaway agent
  // fails fast.

  @UseGuards(BridgeTokenGuard)
  // Override the registered `long` throttler (100/60s → 120/60s); a bare
  // `default` key matches no registered throttler and would be silently inert.
  @Throttle({ long: { limit: 120, ttl: 60_000 } })
  @Get("commands/next")
  @ApiOperation({
    summary:
      "Bridge claims the next queued command across its devices (returns [] if none). Auth: Authorization: Bridge <token>",
  })
  async nextCommand(@Req() req: any) {
    // Return an array (0 or 1 element) so the Rust agent's Vec<PendingCommand>
    // decoder is satisfied — a bare null would fail its decode and back off.
    const cmd = await this.queue.claimNextForBridge(req.bridge.id);
    return cmd ? [cmd] : [];
  }

  @UseGuards(BridgeTokenGuard)
  @Throttle({ long: { limit: 120, ttl: 60_000 } })
  @Post("commands/:commandId/ack")
  @ApiOperation({
    summary: "Bridge acks a command outcome for one of its devices",
  })
  ackCommand(
    @Req() req: any,
    @Param("commandId") commandId: string,
    @Body() dto: AckCommandDto,
  ) {
    return this.queue.ackForBridge(req.bridge.id, commandId, dto);
  }
}
