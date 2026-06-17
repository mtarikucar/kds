import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { numericEnv } from "../../common/config/numeric-env.util";
import { Prisma } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { PrismaService } from "../../prisma/prisma.service";
import { OutboxService } from "../outbox/outbox.service";
import { captureSwallowedEmit } from "../../common/observability/capture-swallowed-emit";

/**
 * Per-device FIFO command queue with priority.
 *
 * Enqueue is idempotent on (deviceId, idempotencyKey). The device pulls the
 * next queued command, transitions it to `inflight`, and acks with done/failed.
 * Cancellation of an inflight command is intentionally NOT supported — the
 * device has already started executing, and the safe model is "let it finish,
 * then send a compensating command".
 */
@Injectable()
export class CommandQueueService {
  private readonly logger = new Logger(CommandQueueService.name);
  private static readonly MAX_ATTEMPTS = 5;

  /**
   * deep-review M19/M21 — side-effecting, NON-idempotent command kinds.
   *
   * These move real-world money or produce legally-binding artefacts:
   *   - charge_card    → contacts the acquirer; a re-delivery double-charges.
   *   - fiscal_receipt → prints a yazarkasa fiscal receipt; a duplicate is a
   *                      tax/legal exposure.
   *   - fiscal_cancel  → fiscal void; double-void corrupts the fiscal journal.
   *   - open_drawer    → physically re-opens the cash drawer.
   *   - print_receipt  → emits a customer receipt (cosmetic but undesirable
   *                      to duplicate; included so the agent gets a stable
   *                      no-auto-retry contract for all paper-emitting kinds).
   *
   * For these, the server NEVER auto-redelivers after a failed/lost ack: the
   * device may already have executed the side effect with no surviving ack
   * (terminal charged → app crashed → no result reached us). Re-queuing would
   * charge the customer / print the receipt a second time. Instead they
   * terminate in `failed` and an operator reconciles with an explicit
   * compensating command. Safe/idempotent kinds (show_order, clear_order,
   * capability_probe, reboot, noop, …) keep the normal retry path.
   *
   * NOTE: kinds use the DTO's dot/underscore identifier space; we match the
   * canonical forms the bridge dispatcher actually executes today. New
   * side-effecting kinds MUST be added here.
   */
  private static readonly NON_RETRYABLE_KINDS = new Set<string>([
    "charge_card",
    "fiscal_receipt",
    "fiscal_cancel",
    "open_drawer",
    "print_receipt",
  ]);

  private static isNonRetryableKind(kind: string): boolean {
    return CommandQueueService.NON_RETRYABLE_KINDS.has(kind);
  }
  // 30 minutes — long enough for slow ESC/POS prints + occasional yazarkasa
  // network blips, short enough that operators see stuck commands cleared.
  // Override via DEVICE_COMMAND_TTL_MS.
  private readonly defaultTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly config?: ConfigService,
  ) {
    this.defaultTtlMs = numericEnv(
      this.config?.get("DEVICE_COMMAND_TTL_MS"),
      30 * 60 * 1000,
    );
  }

  async enqueue(
    tenantId: string,
    deviceId: string,
    input: {
      kind: string;
      payload: Record<string, unknown>;
      priority?: number;
      idempotencyKey?: string;
    },
    // deep-review H14 — branch-scope constraint on the device lookup.
    // When the caller passes a `branchId` (non-wildcard, e.g. a MANAGER
    // limited to a single branch), the target device MUST live in that
    // branch or the lookup returns null → 404. ADMINs acting tenant-wide
    // pass `undefined` and retain the tenant-wide reach. Omitting the
    // arg preserves the pre-fix behaviour (tenant-wide) so existing
    // callers compile unchanged; the controller is expected to forward
    // the branch scope so a branch-restricted manager can't drive payment
    // terminals / cash drawers / fiscal printers in another branch.
    branchId?: string,
  ) {
    const device = await this.prisma.device.findFirst({
      where: {
        id: deviceId,
        tenantId,
        ...(branchId ? { branchId } : {}),
      },
      select: { id: true, status: true, branchId: true },
    });
    if (!device) throw new NotFoundException("Device not found");
    if (device.status === "retired")
      throw new BadRequestException("Device retired");

    const idempotencyKey = input.idempotencyKey ?? uuidv7();
    try {
      const row = await this.prisma.deviceCommand.create({
        data: {
          id: uuidv7(),
          tenantId,
          branchId: device.branchId,
          deviceId,
          kind: input.kind,
          payload: input.payload as any,
          priority: input.priority ?? 0,
          idempotencyKey,
          expiresAt: new Date(Date.now() + this.defaultTtlMs),
        },
      });
      await this.outbox
        .append({
          type: "device.command.created.v1",
          tenantId,
          payload: { commandId: row.id, deviceId, kind: row.kind },
        })
        .catch(
          captureSwallowedEmit(this.logger, {
            module: "device-mesh",
            op: "command-enqueue",
          }),
        );
      return row;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        // Idempotency hit — return the existing row so the caller sees the
        // same outcome as if they'd been the first to send.
        const existing = await this.prisma.deviceCommand.findUnique({
          where: { deviceId_idempotencyKey: { deviceId, idempotencyKey } },
        });
        if (existing) return existing;
      }
      throw e;
    }
  }

  /**
   * Atomically claim the next queued command. Used by the device polling loop
   * (REST) or the WSS push notifier. Returns null when nothing is queued.
   *
   * The `FOR UPDATE SKIP LOCKED` shape keeps this safe under multiple
   * simultaneous claimers (e.g. a buggy device opening two connections).
   */
  async claimNext(deviceId: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        tenantId: string;
        kind: string;
        payload: any;
        priority: number;
        attempts: number;
        idempotencyKey: string;
      }>
    >`
      UPDATE "device_commands"
         SET "status" = 'inflight', "attempts" = "attempts" + 1
       WHERE "id" IN (
         SELECT "id" FROM "device_commands"
          WHERE "deviceId" = ${deviceId}
            AND "status" = 'queued'
            AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
          ORDER BY "priority" DESC, "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       RETURNING "id", "tenantId", "kind", "payload", "priority", "attempts", "idempotencyKey";
    `;
    return rows[0] ?? null;
  }

  async ack(
    deviceId: string,
    commandId: string,
    input: {
      status: "done" | "failed";
      result?: Record<string, unknown>;
      error?: string;
    },
  ) {
    // Compound WHERE at the DB layer rather than `findUnique` + in-JS
    // `deviceId !==` check. The post-fetch check is an IDOR-adjacent
    // pattern — if a future refactor drops the comparison, the row's
    // tenantId/payload leaks back via the throw path. Codebase
    // convention (see orders.service, kds.service, webhook-outbound)
    // is to enforce scope at the query layer.
    const cmd = await this.prisma.deviceCommand.findFirst({
      where: { id: commandId, deviceId },
    });
    if (!cmd) throw new NotFoundException("Command not found");
    if (cmd.status !== "inflight")
      throw new BadRequestException(`Cannot ack — status is ${cmd.status}`);

    // Failed commands with retries remaining go back to `queued`; otherwise
    // they terminate in `failed`. Done commands are terminal regardless.
    //
    // deep-review M21 — side-effecting (non-idempotent) kinds are NEVER
    // auto-requeued on a failed/lost ack. A terminal that charged the
    // acquirer then lost its result on the way back must NOT be re-issued
    // — that double-charges the customer / duplicates the fiscal receipt.
    // Such commands terminate directly in `failed` (ackedAt set, error
    // surfaced) and emit device.command.failed.v1 for an operator to
    // reconcile with an explicit compensating command.
    let nextStatus: "done" | "failed" | "queued" = input.status;
    if (
      input.status === "failed" &&
      cmd.attempts < CommandQueueService.MAX_ATTEMPTS &&
      !CommandQueueService.isNonRetryableKind(cmd.kind)
    ) {
      nextStatus = "queued";
    }

    // Compound-WHERE updateMany + count check closes the same TOCTOU
    // window as the read above: the deviceId stays in scope from query
    // to write, so a row-id-only update can't accidentally clobber a
    // different device's command if the JS code is refactored.
    const claim = await this.prisma.deviceCommand.updateMany({
      where: { id: commandId, deviceId, status: "inflight" },
      data: {
        status: nextStatus,
        result: (input.result as any) ?? undefined,
        error: input.error ?? null,
        ackedAt:
          input.status === "done" || nextStatus === "failed"
            ? new Date()
            : null,
      },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Command status changed concurrently — refresh and retry",
      );
    }
    const updated = await this.prisma.deviceCommand.findUniqueOrThrow({
      where: { id: commandId },
    });

    await this.outbox
      .append({
        type:
          input.status === "done"
            ? "device.command.completed.v1"
            : nextStatus === "failed"
              ? "device.command.failed.v1"
              : "device.command.requeued.v1",
        tenantId: cmd.tenantId,
        payload: {
          commandId,
          deviceId,
          kind: cmd.kind,
          attempts: cmd.attempts,
          error: input.error,
        },
      })
      .catch(
        captureSwallowedEmit(this.logger, {
          module: "device-mesh",
          op: "command-ack",
        }),
      );

    return updated;
  }

  /**
   * Sweeper for expired in-flight commands — devices that crashed mid-ack.
   * Flips inflight → queued so the next claim attempt can pick them up,
   * unless attempts >= MAX in which case they go to `failed`.
   *
   * The signal is "this command was last touched > 5min ago". `updatedAt`
   * bumps on every status transition (queued → inflight → ...), so it's
   * the correct proxy for "claimed and never ack'd". Using `createdAt`
   * would sweep a slow-claim queue: a command created an hour ago that
   * JUST went inflight 10s ago would be wrongly marked stuck.
   *
   * Implemented as a fixed set of updateMany calls (one per branch:
   * requeue / give-up / side-effecting-fail / expired) rather than the
   * previous findMany + per-row update loop. The old shape was an N+1
   * (one round-trip per stuck command), so a sweep with 10K stale rows
   * held the connection for as many serialised writes; the new shape is
   * a constant number of statements regardless of N and lets Postgres
   * pick the index path it likes.
   */
  async sweepStuck(): Promise<number> {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const now = new Date();
    // v2.8.97 — also transition expired-queued commands to `expired`
    // so they're explicitly visible to the admin instead of sitting
    // in `queued` status with expiresAt in the past (where claimNext
    // silently skips them and nobody is alerted). The `expired` row
    // still carries the original payload for forensic review.
    // deep-review M19/M21 — the sweeper is the MORE dangerous redelivery
    // path (crash-after-charge with no surviving ack), so the kind guard
    // applied in ack() MUST also apply here or the TTL sweeper silently
    // bypasses it. The inflight-requeue branch therefore excludes the
    // non-idempotent kinds (`kind: { notIn }`); those are routed instead
    // to a terminal `failed` state regardless of attempts — a stuck
    // inflight charge_card/fiscal_receipt is never put back on the queue.
    // Operators see the `failed` row + device.command.failed.v1 (emitted
    // by the ack path / surfaced via the admin view) and reconcile with an
    // explicit compensating command rather than the server blindly
    // re-charging.
    const nonRetryable = [...CommandQueueService.NON_RETRYABLE_KINDS];
    const [requeue, fail, sideEffectFail, expired] =
      await this.prisma.$transaction([
        this.prisma.deviceCommand.updateMany({
          where: {
            status: "inflight",
            updatedAt: { lt: cutoff },
            attempts: { lt: CommandQueueService.MAX_ATTEMPTS },
            kind: { notIn: nonRetryable },
          },
          data: { status: "queued", error: "No ack received; requeued" },
        }),
        this.prisma.deviceCommand.updateMany({
          where: {
            status: "inflight",
            updatedAt: { lt: cutoff },
            attempts: { gte: CommandQueueService.MAX_ATTEMPTS },
            kind: { notIn: nonRetryable },
          },
          data: { status: "failed", error: "No ack received; giving up" },
        }),
        // Side-effecting kinds: terminate in `failed` regardless of
        // attempts. Never auto-retried — the device may already have
        // moved real money / printed a fiscal receipt.
        this.prisma.deviceCommand.updateMany({
          where: {
            status: "inflight",
            updatedAt: { lt: cutoff },
            kind: { in: nonRetryable },
          },
          data: {
            status: "failed",
            error:
              "No ack received; not auto-retried (side-effecting) — requires manual compensating command",
          },
        }),
        this.prisma.deviceCommand.updateMany({
          where: {
            status: "queued",
            expiresAt: { lt: now, not: null },
          },
          data: {
            status: "expired",
            error: "TTL expired before device claimed",
          },
        }),
      ]);
    const total =
      requeue.count + fail.count + sideEffectFail.count + expired.count;
    if (total > 0) {
      this.logger.warn(
        `Swept ${total} stuck device commands (requeued=${requeue.count} failed=${fail.count} sideEffectFailed=${sideEffectFail.count} expired=${expired.count})`,
      );
    }
    return total;
  }

  async listForDevice(
    tenantId: string,
    deviceId: string,
    filters?: { status?: string; limit?: number },
    // deep-review H14 — same branch-scope guard as enqueue(). A
    // branch-restricted caller (non-wildcard `branchId`) can only inspect
    // command queues for devices in their own branch; a cross-branch
    // deviceId yields an empty list rather than leaking another branch's
    // command history. ADMINs acting tenant-wide pass undefined.
    branchId?: string,
  ) {
    return this.prisma.deviceCommand.findMany({
      where: {
        tenantId,
        deviceId,
        ...(branchId ? { branchId } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(filters?.limit ?? 100, 500),
    });
  }
}
