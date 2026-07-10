import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { numericEnv } from "../../common/config/numeric-env.util";
import { createHash, randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { PrismaService } from "../../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { captureSwallowedEmit } from "../../common/observability/capture-swallowed-emit";

/**
 * Device registry + pairing + heartbeat + command queue.
 *
 * Lifecycle:
 *   admin creates slot   -> status='unprovisioned', pairCode generated (10m TTL)
 *   device pairs          -> status='paired', tokenHash set, pairCode cleared
 *   first heartbeat       -> status='online', lastSeenAt updated
 *   no heartbeat for 60s  -> status='offline' (set by sweepStale cron)
 *   admin retires         -> status='retired'
 *
 * Tokens are stored as sha256 hashes. The raw token is returned exactly once
 * (at pair time and on refresh) and never persisted.
 */
@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);
  // Pair-code lifetime (default 10m) and bearer-token lifetime (default 24h).
  // Override via DEVICE_PAIR_CODE_TTL_MS / DEVICE_TOKEN_TTL_MS.
  private readonly pairCodeTtlMs: number;
  private readonly tokenTtlMs: number;
  // v2.8.97 — tightened from 60s to 45s. Combined with the sweeper's
  // 60s cron tick the worst-case "online but actually offline" window
  // drops from ~120s to ~105s. The 10s default heartbeat interval
  // (set in the agent SDK) means a healthy device hits 4–5 heartbeats
  // inside this grace, so the only real path to a false "offline"
  // is a sustained network drop — which is exactly what we want
  // surfaced.
  private static readonly HEARTBEAT_GRACE_MS = 45 * 1000;
  // Max concurrent un-paired slots per branch — stops "create slot" from
  // spawning unbounded phantom devices that never get paired. Expired ones
  // are pruned by the sweep cron (pruneExpiredUnprovisioned).
  private static readonly MAX_PENDING_SLOTS_PER_BRANCH = 10;
  // Grace after a pairCode expires before the never-paired slot is deleted.
  private static readonly UNPROVISIONED_PRUNE_GRACE_MS = 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly config?: ConfigService,
  ) {
    this.pairCodeTtlMs = numericEnv(
      this.config?.get("DEVICE_PAIR_CODE_TTL_MS"),
      10 * 60 * 1000,
    );
    this.tokenTtlMs = numericEnv(
      this.config?.get("DEVICE_TOKEN_TTL_MS"),
      24 * 3600 * 1000,
    );
  }

  /** Cryptographic, human-typable pair code. 6 chars in [A-Z0-9]. */
  private newPairCode(): string {
    // Reject I/O/0/1 to reduce typo confusion? The reduction in entropy is
    // small enough vs. the typo win that some POS vendors do it; we keep the
    // full alphabet for now to maximise space — 36^6 ≈ 2.2B for a 10min TTL.
    //
    // v2.8.97 — rejection sampling for uniform distribution. Pre-fix
    // `byte % 36` gave the first 256 % 36 = 4 alphabet positions a
    // ~0.4% higher selection probability (a tiny but documented modulo
    // bias). Rejection sampling against the largest multiple of 36
    // ≤ 256 (= 252) eliminates the bias at the cost of a tiny retry
    // overhead (~1.5% of bytes rejected).
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const ceiling = 256 - (256 % alphabet.length); // 252
    const chars: string[] = [];
    while (chars.length < 6) {
      const buf = randomBytes(8);
      for (let i = 0; i < buf.length && chars.length < 6; i++) {
        if (buf[i] >= ceiling) continue; // rejection sample
        chars.push(alphabet[buf[i] % alphabet.length]);
      }
    }
    return chars.join("");
  }

  private newToken(): string {
    return uuidv7() + "." + randomBytes(24).toString("base64url");
  }

  private hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  async createSlot(
    tenantId: string,
    input: {
      kind: string;
      branchId?: string;
      capabilities?: string[];
      model?: string;
      serial?: string;
      ownership?: "sold" | "rented" | "byo";
      // Free-form provisioning config (e.g. { hardwareOrderId, sku } when the
      // slot is auto-created by a hardware purchase).
      config?: Record<string, unknown>;
      // Bypass the per-branch pending-slot cap. ONLY for trusted bulk
      // provisioning (a paid hardware order), never the interactive button.
      skipPendingCap?: boolean;
    },
  ) {
    // branchId is required: v3 branch-scope-strict made devices.branchId
    // NOT NULL, so every slot must land in a concrete branch. The admin route
    // resolves it from the X-Branch-Id scope; reject early if it never made it
    // through (and stop the stale `?? null` below from producing the confusing
    // Prisma "Argument `tenant` is missing" fallback error).
    if (!input.branchId) {
      throw new BadRequestException(
        "branchId is required to create a device slot",
      );
    }
    const branch = await this.prisma.branch.findFirst({
      where: { id: input.branchId, tenantId },
    });
    if (!branch) {
      throw new BadRequestException("Branch not found for this tenant");
    }
    // Anti-phantom: cap concurrent un-paired slots in this branch. Without
    // this, every "create slot" click persists an unprovisioned device that
    // lingers until the prune cron — spam-clicking floods the list. The cap
    // forces the operator to pair (or wait for the prune) before piling on.
    if (!input.skipPendingCap) {
      const pending = await this.prisma.device.count({
        where: { tenantId, branchId: input.branchId, status: "unprovisioned" },
      });
      if (pending >= DeviceService.MAX_PENDING_SLOTS_PER_BRANCH) {
        throw new BadRequestException(
          `Too many devices are waiting to be paired in this branch (${pending}). Pair or remove them before adding more.`,
        );
      }
    }
    let pairCode = this.newPairCode();
    // Retry on collision — pairCode is globally unique. 36^6 makes
    // collisions vanishingly rare but the retry is harmless.
    //
    // v2.8.97 — log each collision and bail with a 503 if all five
    // attempts collide. Pre-fix a 5x exhaustion silently used the last
    // candidate which would then collide on insert and throw P2002 —
    // confusing 500. With clean bail the operator gets a retryable
    // 503 instead.
    let attempts = 0;
    for (let i = 0; i < 5; i++) {
      const exists = await this.prisma.device.findUnique({
        where: { pairCode },
      });
      if (!exists) break;
      attempts = i + 1;
      this.logger.warn(
        `Pair code collision (attempt=${attempts}) tenant=${tenantId}; regenerating`,
      );
      pairCode = this.newPairCode();
    }
    if (attempts >= 5) {
      throw new Error(
        "Could not allocate unique pair code after 5 attempts — retry the request",
      );
    }

    const row = await this.prisma.device.create({
      data: {
        // Relation `connect` form rather than scalar tenantId/branchId: both
        // Tenant and Branch are required relations, so connecting them
        // explicitly is the unambiguous Prisma idiom and avoids the
        // checked/unchecked-input fallback that surfaced as
        // "Argument `tenant` is missing".
        tenant: { connect: { id: tenantId } },
        branch: { connect: { id: input.branchId } },
        kind: input.kind,
        capabilities: input.capabilities ?? [],
        status: "unprovisioned",
        model: input.model,
        serial: input.serial,
        ownership: input.ownership ?? "byo",
        pairCode,
        pairCodeExpiresAt: new Date(Date.now() + this.pairCodeTtlMs),
        config: (input.config ?? undefined) as any,
      },
    });

    await this.outbox
      .append({
        type: "device.slot_created.v1",
        tenantId,
        payload: { deviceId: row.id, kind: row.kind, branchId: row.branchId },
      })
      .catch(
        captureSwallowedEmit(this.logger, {
          module: "device-mesh",
          op: "slot-created",
        }),
      );

    // Return the pair code in the slot-creation response — it's not a
    // secret per se, but it gates pairing for 10 minutes. UI shows it on
    // the screen the operator uses to pair the device.
    return { ...row, pairCode };
  }

  // Maps a HardwareProduct.category to the device-mesh `kind` we provision a
  // slot for after a paid purchase. Categories with no entry (cash_drawer,
  // other, service) are peripherals/labour that don't pair as their own
  // mesh device — they're skipped. Keep the right-hand values inside the
  // CreateDeviceSlotDto KINDS enum (dto/device.dto.ts) or pairing will reject.
  private static readonly CATEGORY_TO_DEVICE_KIND: Record<string, string> = {
    kds_screen: "kds_screen",
    pos_terminal: "pos_terminal",
    printer: "receipt_printer",
    tablet: "tablet_waiter",
    bridge: "local_bridge",
    yazarkasa: "yazarkasa",
    scanner: "scanner",
    caller_id: "caller_id",
  };

  /**
   * After a hardware order is paid, auto-create an unprovisioned device slot
   * for each purchased device-class line (one per unit) so the operator can
   * pair them straight away instead of hand-creating slots that mirror what
   * they just bought.
   *
   * Contract / safety:
   *  - Best-effort: the caller (CheckoutService) invokes this AFTER the order
   *    is committed and wraps the call in try/catch. A failure here must never
   *    surface to the buyer — the order is already paid. We log and move on.
   *  - Idempotent + count-aware: each slot carries a deterministic
   *    config.provisionKey (`${orderId}:${productId}:${unitIndex}`). A (re)run
   *    creates only the units whose key isn't already present, so a replay
   *    never duplicates AND a partially-failed run can be completed later
   *    (no permanent under-provisioning). confirmAndProvision can call this
   *    twice on the same paymentRef (webhook retry / self-heal replay).
   *  - Concurrency-safe: the "which units exist?" check + creation run under a
   *    tx-scoped Postgres advisory lock keyed on the order id, so two calls
   *    racing for the same order (a PayTR retry overlapping the original) can't
   *    both pass the check and double-create. The lock auto-releases at tx end
   *    on its pinned connection (no pooled-connection leak).
   *  - Peripherals (cash_drawer/other/service) and unmapped categories are
   *    skipped — only true mesh devices get a slot.
   *  - skipPendingCap: provisioning bypasses MAX_PENDING_SLOTS_PER_BRANCH —
   *    this is a trusted, paid bulk action, not interactive spam.
   *
   * Returns the number of slots created (0 if nothing applicable / already done).
   */
  async provisionPurchasedDevices(
    tenantId: string,
    branchId: string | null,
    hardwareOrderId: string,
    items: { productId: string; sku: string; qty: number; category: string }[],
  ): Promise<number> {
    // Keep only lines that map to a real mesh device kind.
    const provisionable = items
      .map((it) => ({
        ...it,
        kind: DeviceService.CATEGORY_TO_DEVICE_KIND[it.category],
      }))
      .filter((it) => !!it.kind && it.qty > 0);
    if (provisionable.length === 0) return 0;

    const targetBranchId = await this.resolveProvisionBranch(
      tenantId,
      branchId,
    );
    if (!targetBranchId) {
      this.logger.warn(
        `Cannot provision devices for order ${hardwareOrderId}: no active branch for tenant ${tenantId}`,
      );
      return 0;
    }

    // Expand to one desired unit per qty, each with a stable identity so a
    // retry/replay is idempotent and a partial run is completable.
    const desired = provisionable.flatMap((line) =>
      Array.from({ length: line.qty }, (_, unitIndex) => ({
        kind: line.kind!,
        sku: line.sku,
        productId: line.productId,
        provisionKey: `${hardwareOrderId}:${line.productId}:${unitIndex}`,
      })),
    );

    let created = 0;
    // Serialize concurrent provisioning of the SAME order under an advisory
    // lock; createSlot runs on its own (autocommitting) connection so the rows
    // it writes are visible to a waiter the instant this tx releases the lock.
    // Generous timeout: a large multi-unit order may take a few seconds, and a
    // timeout is harmless anyway — the provisionKey check makes a later retry
    // complete only the missing units.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hw-device-provision'), hashtext(${hardwareOrderId}))`;
        const existing = await tx.device.findMany({
          where: {
            tenantId,
            config: { path: ["hardwareOrderId"], equals: hardwareOrderId },
          },
          select: { config: true },
        });
        const existingKeys = new Set(
          existing
            .map(
              (d) =>
                (d.config as { provisionKey?: string } | null)?.provisionKey,
            )
            .filter((k): k is string => !!k),
        );
        for (const unit of desired) {
          if (existingKeys.has(unit.provisionKey)) continue;
          try {
            await this.createSlot(tenantId, {
              kind: unit.kind,
              branchId: targetBranchId,
              ownership: "sold",
              skipPendingCap: true,
              config: {
                hardwareOrderId,
                sku: unit.sku,
                productId: unit.productId,
                provisionKey: unit.provisionKey,
                provisionedAt: new Date().toISOString(),
              },
            });
            created++;
          } catch (err) {
            // One bad slot must not abort the rest — log and continue. The
            // order is already paid; partial provisioning beats none, and the
            // provisionKey lets a retry fill the gap.
            this.logger.error(
              `Failed to provision slot (order=${hardwareOrderId}, sku=${unit.sku}, kind=${unit.kind}): ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      },
      { timeout: 30000, maxWait: 10000 },
    );
    if (created > 0) {
      this.logger.log(
        `Provisioned ${created} device slot(s) in branch ${targetBranchId} for hardware order ${hardwareOrderId}`,
      );
    }
    return created;
  }

  /**
   * Decide which branch a paid hardware order's device slots land in:
   *   1. the explicit branchId on the order (the buyer's selected scope), if it
   *      still exists and is active;
   *   2. else the tenant's headquarters branch (isHeadquarters), if active;
   *   3. else the earliest-created active branch.
   * Returns null if the tenant has no active branch at all (caller no-ops).
   */
  private async resolveProvisionBranch(
    tenantId: string,
    branchId: string | null,
  ): Promise<string | null> {
    if (branchId) {
      const explicit = await this.prisma.branch.findFirst({
        where: { id: branchId, tenantId, status: "active" },
        select: { id: true },
      });
      if (explicit) return explicit.id;
    }
    const hq = await this.prisma.branch.findFirst({
      where: { tenantId, isHeadquarters: true, status: "active" },
      select: { id: true },
    });
    if (hq) return hq.id;
    const earliest = await this.prisma.branch.findFirst({
      where: { tenantId, status: "active" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    return earliest?.id ?? null;
  }

  async list(
    tenantId: string,
    filters?: {
      branchId?: string;
      branchIds?: string[];
      kind?: string;
      status?: string;
    },
  ) {
    // v2.8.97 — explicit select. Pre-fix the list returned every column
    // including pairCode (still-active if pre-pair), pairCodeExpiresAt,
    // and tokenHash (sha256, but still — no reason to ship hashes
    // outside the auth path). Operators only need identity + status to
    // populate the device-list UI; the per-device admin view fetches
    // sensitive bits separately. Defense-in-depth against a future
    // controller that pipes list() output to the wire without
    // sanitisation.
    return this.prisma.device.findMany({
      where: {
        tenantId,
        ...(filters?.branchId
          ? { branchId: filters.branchId }
          : filters?.branchIds
            ? { branchId: { in: filters.branchIds } }
            : {}),
        ...(filters?.kind ? { kind: filters.kind } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        kind: true,
        capabilities: true,
        status: true,
        lastSeenAt: true,
        serial: true,
        model: true,
        ownership: true,
        warrantyUntil: true,
        bridgeId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ branchId: "asc" }, { kind: "asc" }, { createdAt: "asc" }],
    });
  }

  async findOrThrow(tenantId: string, id: string) {
    // Compound WHERE — see branches.service.ts:findOrThrow for the
    // defense-in-depth rationale. The row returned is exposed to the
    // caller, so a future refactor that drops the `!==` check would
    // leak a cross-tenant device's pairing metadata.
    const row = await this.prisma.device.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("Device not found");
    return row;
  }

  /** Device → server pair. Returns the raw token; never stored raw. */
  async pair(input: {
    pairCode: string;
    model?: string;
    serial?: string;
    capabilities?: string[];
  }) {
    const row = await this.prisma.device.findUnique({
      where: { pairCode: input.pairCode },
    });
    if (!row) throw new NotFoundException("Pair code invalid or expired");
    if (!row.pairCodeExpiresAt || row.pairCodeExpiresAt < new Date()) {
      // Atomically clear the expired code so it cannot be reused.
      await this.prisma.device.update({
        where: { id: row.id },
        data: { pairCode: null, pairCodeExpiresAt: null },
      });
      throw new BadRequestException("Pair code expired — request a new one");
    }

    const token = this.newToken();
    const tokenHash = this.hashToken(token);
    const tokenExpiresAt = new Date(Date.now() + this.tokenTtlMs);

    // Atomic single-use pair-code claim.
    //
    // The previous shape did findUnique → validate → update by id. Two
    // physical devices typing the same 6-char code into their kiosks
    // milliseconds apart both passed the validation and both ran
    // update — the second overwrites the first's tokenHash, so the
    // device that THOUGHT it paired earlier silently ends up with a
    // token the server has forgotten. The user-visible failure is
    // "your device randomly stopped working" hours later when the
    // token fails authenticateToken and the kiosk falls back to the
    // pair-code prompt — confusing both ops and the operator.
    //
    // updateMany with `pairCode = X AND pairCodeExpiresAt > now`
    // serialises the writers at the row level: the first writer flips
    // pairCode to NULL and the predicate stops matching for the second
    // writer (Postgres single-row update is atomic). The loser sees
    // count=0 and surfaces the same "already claimed" error PayTR's
    // settlement race uses for symmetric clarity.
    const now = new Date();
    const claim = await this.prisma.device.updateMany({
      where: {
        id: row.id,
        pairCode: input.pairCode,
        pairCodeExpiresAt: { gt: now },
        // A retired slot must never be re-paired even if a stale pair code
        // lingered (retire() now also nulls the code, but this guard is the
        // authoritative stop against resurrection).
        status: { not: "retired" },
      },
      data: {
        status: "paired",
        tokenHash,
        tokenExpiresAt,
        pairCode: null,
        pairCodeExpiresAt: null,
        model: input.model ?? row.model,
        serial: input.serial ?? row.serial,
        capabilities: input.capabilities ?? row.capabilities,
        lastSeenAt: now,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Pair code already claimed by another device or expired — request a new one",
      );
    }
    // v2.8.94 — defense-in-depth: re-fetch with (id, tenantId) compound.
    // Pre-fix the response lookup ran id-only, so a future regression of
    // the atomic claim above could leak a cross-tenant device row to the
    // pairing caller.
    const updated = await this.prisma.device.findFirstOrThrow({
      where: { id: row.id, tenantId: row.tenantId },
    });

    await this.outbox
      .append({
        type: "device.paired.v1",
        tenantId: row.tenantId,
        payload: { deviceId: row.id, kind: row.kind, branchId: row.branchId },
      })
      .catch(
        captureSwallowedEmit(this.logger, {
          module: "device-mesh",
          op: "device-paired",
        }),
      );

    return {
      deviceId: updated.id,
      tenantId: updated.tenantId,
      branchId: updated.branchId,
      kind: updated.kind,
      token,
      tokenExpiresAt,
      capabilities: updated.capabilities,
    };
  }

  /** Authenticate a device token (raw). Returns the device row. */
  async authenticateToken(rawToken: string) {
    if (!rawToken) return null;
    const tokenHash = this.hashToken(rawToken);
    const row = await this.prisma.device.findFirst({
      where: { tokenHash },
    });
    if (!row) return null;
    if (row.tokenExpiresAt && row.tokenExpiresAt < new Date()) return null;
    return row;
  }

  async heartbeat(
    deviceId: string,
    payload: {
      batteryPct?: number;
      ip?: string;
      agentVersion?: string;
      queueDepth?: number;
    },
  ) {
    const now = new Date();
    await this.prisma.device.update({
      where: { id: deviceId },
      data: {
        status: "online",
        lastSeenAt: now,
        // Slide the bearer-token expiry forward on every heartbeat. pair() is
        // the only other writer of tokenExpiresAt (now + tokenTtlMs); without
        // this slide an actively-heartbeating device would still hard-fail
        // authenticateToken() at the fixed TTL (default 24h), so the whole
        // paired fleet (KDS/POS/printer/drawer) would stop authenticating a day
        // after pairing with no self-recovery. A heartbeating device is
        // already authenticated, so extending its TTL is safe.
        tokenExpiresAt: new Date(now.getTime() + this.tokenTtlMs),
      },
    });
    if (payload && Object.keys(payload).length > 0) {
      await this.prisma.deviceLog
        .create({
          data: {
            id: uuidv7(),
            tenantId: (await this.prisma.device.findUnique({
              where: { id: deviceId },
              select: { tenantId: true },
            }))!.tenantId,
            deviceId,
            level: "info",
            category: "heartbeat",
            message: "heartbeat",
            payload: payload as any,
          },
        })
        .catch(() => undefined);
    }
    return { ok: true, ts: now.toISOString() };
  }

  /**
   * Background sweep: any device with lastSeenAt older than the grace window
   * gets flipped to offline. Idempotent; safe to run every minute.
   */
  async sweepStale(): Promise<number> {
    const cutoff = new Date(Date.now() - DeviceService.HEARTBEAT_GRACE_MS);
    const res = await this.prisma.device.updateMany({
      where: {
        status: "online",
        lastSeenAt: { lt: cutoff },
      },
      data: { status: "offline" },
    });
    if (res.count > 0) this.logger.debug(`Marked ${res.count} devices offline`);
    return res.count;
  }

  /**
   * Background prune: delete never-paired slots whose pairCode has expired
   * (plus a grace). Fixes the "create slot → phantom device that lingers
   * forever" problem — an unprovisioned device that nobody paired within the
   * 10-min window is junk, so it is removed rather than cluttering the list.
   * Only touches `unprovisioned` rows (a paired/online device is never pruned).
   * Idempotent; safe to run every minute.
   */
  async pruneExpiredUnprovisioned(): Promise<number> {
    const cutoff = new Date(
      Date.now() - DeviceService.UNPROVISIONED_PRUNE_GRACE_MS,
    );
    const res = await this.prisma.device.deleteMany({
      where: {
        status: "unprovisioned",
        pairCodeExpiresAt: { lt: cutoff },
      },
    });
    if (res.count > 0) {
      this.logger.debug(`Pruned ${res.count} never-paired (expired) slots`);
    }
    return res.count;
  }

  /**
   * Per-branch device tallies for the branch hub cards. `total`/`online` count
   * only REAL devices (paired/online/offline) — unprovisioned pending slots are
   * reported separately so the hub shows a meaningful number, not phantom slots.
   */
  async countsByBranch(
    tenantId: string,
  ): Promise<
    Record<string, { total: number; online: number; pending: number }>
  > {
    const rows = await this.prisma.device.groupBy({
      by: ["branchId", "status"],
      where: { tenantId, status: { not: "retired" } },
      _count: { _all: true },
    });
    const out: Record<
      string,
      { total: number; online: number; pending: number }
    > = {};
    for (const r of rows) {
      const b = (out[r.branchId] ??= { total: 0, online: 0, pending: 0 });
      const n = r._count._all;
      if (r.status === "unprovisioned") {
        b.pending += n;
      } else {
        b.total += n;
        if (r.status === "online") b.online += n;
      }
    }
    return out;
  }

  /**
   * Attach a device behind a local bridge — or detach it back to cloud-direct
   * with `bridgeId = null`. Until now NOTHING wrote Device.bridgeId, so
   * bridge-fronted hardware (yazarkasa, card terminals) rendered as
   * cloud-direct in the branch topology and `claimNextForBridge()` could never
   * fan-in their commands. Guards: the bridge must belong to the same tenant
   * AND the same branch as the device (a bridge only serves its own LAN) and
   * must not be retired.
   */
  async assignBridge(
    tenantId: string,
    deviceId: string,
    bridgeId: string | null,
    scopedBranchId?: string,
  ) {
    const row = await this.findOrThrow(tenantId, deviceId);
    // H14 parity: /v1/devices is a branch-scoped surface, so a
    // branch-restricted caller may only re-home devices in the branch they
    // are scoped to. 404 (not 403) so the response doesn't confirm the
    // device exists in another branch.
    if (scopedBranchId && row.branchId !== scopedBranchId) {
      throw new NotFoundException("Device not found");
    }
    if (bridgeId !== null) {
      const bridge = await this.prisma.localBridgeAgent.findFirst({
        where: { id: bridgeId, tenantId },
        select: { id: true, branchId: true, status: true },
      });
      if (!bridge) throw new NotFoundException("Bridge not found");
      if (bridge.status === "retired") {
        throw new BadRequestException(
          "Bridge is retired — provision a new bridge first",
        );
      }
      if (bridge.branchId !== row.branchId) {
        throw new BadRequestException(
          "Bridge and device must belong to the same branch",
        );
      }
    }
    // Compound WHERE on the write (B41-B45 pattern) — see retire() below.
    const claim = await this.prisma.device.updateMany({
      where: { id: row.id, tenantId },
      data: { bridgeId },
    });
    if (claim.count === 0) throw new NotFoundException("Device not found");
    return this.prisma.device.findFirstOrThrow({
      where: { id: row.id, tenantId },
    });
  }

  async retire(tenantId: string, deviceId: string) {
    const row = await this.findOrThrow(tenantId, deviceId);
    // Compound WHERE (B41-B45 pattern, iter-31 onward). findOrThrow
    // above already proves ownership, but the write surface should
    // carry tenantId itself so a future refactor that drops the
    // pre-check can't leak into a cross-tenant retire that would
    // null someone else's tokenHash and lock their device out.
    const claim = await this.prisma.device.updateMany({
      where: { id: row.id, tenantId },
      // Also void any live pair code: a slot retired while it still carries an
      // unclaimed pairCode/pairCodeExpiresAt could otherwise be resurrected by
      // pair() (which matches on pairCode + expiry). Clearing it here, plus the
      // status guard on pair()'s claim WHERE, closes the resurrection path.
      data: {
        status: "retired",
        tokenHash: null,
        pairCode: null,
        pairCodeExpiresAt: null,
      },
    });
    if (claim.count === 0) throw new NotFoundException("Device not found");
    return this.prisma.device.findFirstOrThrow({
      where: { id: row.id, tenantId },
    });
  }
}
