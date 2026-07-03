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
import { Throttle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { BranchGuard } from "../auth/guards/branch.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { UserRole } from "../../common/constants/roles.enum";
import { Public } from "../auth/decorators/public.decorator";
import { DeviceService } from "./device.service";
import { CommandQueueService } from "./command-queue.service";
import { DeviceTokenGuard } from "./device-token.guard";
import {
  CreateDeviceSlotDto,
  PairDeviceDto,
  HeartbeatDto,
  EnqueueCommandDto,
  AckCommandDto,
} from "./dto/device.dto";

/**
 * Two distinct surfaces in one controller for now:
 *   /admin/*    user-token: tenant admins manage their devices
 *   /agent/*    device-token: the device itself talks here
 *
 * Splitting later is trivial; keeping them co-located right now keeps the
 * mental model coherent ("everything device-mesh is under /v1/devices/...").
 */
@ApiTags("Device Mesh")
@Controller("v1/devices")
export class DevicesController {
  constructor(
    private readonly devices: DeviceService,
    private readonly queue: CommandQueueService,
  ) {}

  // -- Admin (user-auth) endpoints -----------------------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: "List devices for the authenticated tenant" })
  list(
    @Req() req: any,
    @Query("branchId") branchId?: string,
    @Query("kind") kind?: string,
    @Query("status") status?: string,
  ) {
    // Branch-scope the inventory read: a branch-restricted MANAGER (or an ADMIN
    // with a non-empty allow-list) must not enumerate other branches' devices.
    // An explicit ?branchId must be inside the caller's allow-list; without one,
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
    return this.devices.list(req.user.tenantId, {
      ...branchFilter,
      kind,
      status,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({
    summary:
      "Create a device slot — returns a pair code to type into the device",
  })
  create(@Req() req: any, @Body() dto: CreateDeviceSlotDto) {
    // devices.branchId is NOT NULL, so a slot must always land in a concrete
    // branch. Resolve it from the request's branch scope (BranchGuard
    // guarantees req.scope.branchId on this branch-scoped route), with the
    // optional body branchId as an explicit override (the hub creates a slot
    // in the branch being viewed, which may differ from X-Branch-Id).
    const branchId = dto.branchId ?? req.scope?.branchId;
    // H14 parity: the body branchId override must NOT escape the caller's
    // branch allow-list. Without this a branch-restricted MANAGER could mint a
    // slot + valid pair code in a branch they're not assigned to. (ADMIN with
    // an empty allow-list = tenant-wide wildcard.) createSlot still enforces
    // tenant ownership of the branch.
    if (
      branchId &&
      !BranchGuard.canAccessBranchStatic(
        req.user.role,
        branchId,
        req.user.primaryBranchId ?? null,
        req.user.allowedBranchIds ?? [],
      )
    ) {
      throw new ForbiddenException("You cannot manage devices for this branch");
    }
    return this.devices.createSlot(req.user.tenantId, { ...dto, branchId });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @Delete(":id")
  @ApiOperation({ summary: "Retire a device (ADMIN only)" })
  retire(@Req() req: any, @Param("id") id: string) {
    return this.devices.retire(req.user.tenantId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Post(":id/commands")
  @ApiOperation({ summary: "Enqueue a command to a device" })
  enqueueCommand(
    @Req() req: any,
    @Param("id") id: string,
    @Body() dto: EnqueueCommandDto,
  ) {
    // deep-review H14: /v1/devices is a branch-scoped surface, so the global
    // BranchGuard has already validated req.scope.branchId ∈ the caller's
    // allowed branches. Forward it so a branch-restricted MANAGER can only
    // drive devices in the branch they are scoped to — closing the
    // cross-branch "enqueue charge_card/open_drawer/fiscal_receipt to another
    // branch's terminal" vector. A device outside the scoped branch 404s.
    return this.queue.enqueue(req.user.tenantId, id, dto, req.scope?.branchId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @Get(":id/commands")
  @ApiOperation({ summary: "Inspect a device command queue (admin view)" })
  listCommands(
    @Req() req: any,
    @Param("id") id: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return this.queue.listForDevice(
      req.user.tenantId,
      id,
      {
        status,
        limit: limit ? parseInt(limit, 10) : undefined,
      },
      // deep-review H14: scope command-queue inspection to the caller's
      // validated branch (same rationale as enqueueCommand above).
      req.scope?.branchId,
    );
  }

  // -- Device-side (device-token auth) endpoints ---------------------------

  // v2.8.91/94: tight throttle on /pair. The 6-character alphanumeric
  // pair code (~2B combinations) has its own 15-minute TTL guard inside
  // device.service, so the realistic attack window is the TTL × the
  // rate-limit budget. v2.8.91 set 10/min/IP. v2.8.94 tightens to 5/min/IP
  // — a legitimate device pairs exactly once per slot and an operator's
  // re-issue takes seconds, so 5 attempts/min covers human retry while
  // still capping a single-IP brute-force at 75 attempts per TTL window
  // (a vanishing fraction of the 2B space). A distributed attacker
  // bypassing per-IP would need to time their probes within the same
  // 15-minute TTL — at 5/min/IP × 1000 IPs that's still only ~75K
  // attempts per TTL, well under the brute-force budget for a 6-char
  // code.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("pair")
  @ApiOperation({
    summary: "Device pairs using the pair code shown in the admin UI",
  })
  pair(@Body() dto: PairDeviceDto) {
    return this.devices.pair(dto);
  }

  // v2.8.97 — device-token endpoints get explicit throttles. Pre-fix
  // they relied solely on DeviceTokenGuard auth, so a compromised
  // device token could be looped at arbitrary speed (DB CPU burn on
  // claimNext's $queryRaw with FOR UPDATE SKIP LOCKED; index churn on
  // heartbeat's repeated lastSeenAt update). The numbers chosen are
  // ~6× the agent SDK's default polling cadence (1× per 10s for
  // heartbeat, 1× per 5s for next-command), so a legitimate device
  // sees daylight and a runaway agent fails fast.
  @UseGuards(DeviceTokenGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post("heartbeat")
  @ApiOperation({
    summary: "Device-side heartbeat. Auth: Authorization: Device <token>",
  })
  heartbeat(@Req() req: any, @Body() dto: HeartbeatDto) {
    return this.devices.heartbeat(req.device.id, dto);
  }

  @UseGuards(DeviceTokenGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get("next-command")
  @ApiOperation({
    summary: "Device claims the next queued command (returns null if none)",
  })
  nextCommand(@Req() req: any) {
    return this.queue.claimNext(req.device.id);
  }

  @UseGuards(DeviceTokenGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post("commands/:commandId/ack")
  @ApiOperation({ summary: "Device acks a command outcome" })
  ack(
    @Req() req: any,
    @Param("commandId") commandId: string,
    @Body() dto: AckCommandDto,
  ) {
    return this.queue.ack(req.device.id, commandId, dto);
  }
}
