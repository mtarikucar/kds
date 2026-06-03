import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";

/**
 * Read + retry surface for the outbox DLQ. Events that exhaust the worker's
 * MAX_ATTEMPTS land in status='failed' with `nextAttemptAt=null` — without a
 * way to see them, ops only learns about systemic delivery failures via
 * downstream gaps (entitlement out-of-sync, webhook subscribers complaining).
 *
 * This service is the read-out + nudge: list failed rows, show the captured
 * lastError, and re-queue selected events for the worker to retry. Re-queue
 * keeps the existing attempt counter (so a permanently-broken event doesn't
 * loop forever) but resets nextAttemptAt to "now" so the next tick claims it.
 */
@Injectable()
export class SuperAdminOutboxService {
  private readonly logger = new Logger(SuperAdminOutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listFailed(params: {
    tenantId?: string;
    type?: string;
    limit?: number;
    cursor?: string;
  }) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const rows = await this.prisma.outboxEvent.findMany({
      where: {
        status: "failed",
        ...(params.tenantId ? { tenantId: params.tenantId } : {}),
        ...(params.type ? { type: params.type } : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        tenantId: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        dispatchedAt: true,
      },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  async summary() {
    // One round-trip per status so the ops dashboard can show queue health
    // alongside DLQ depth.
    const [queued, dispatching, dispatched, failed] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { status: "queued" } }),
      this.prisma.outboxEvent.count({ where: { status: "dispatching" } }),
      this.prisma.outboxEvent.count({ where: { status: "dispatched" } }),
      this.prisma.outboxEvent.count({ where: { status: "failed" } }),
    ]);
    return { queued, dispatching, dispatched, failed };
  }

  async getEvent(id: string) {
    const row = await this.prisma.outboxEvent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Outbox event not found");
    return row;
  }

  /**
   * Re-queue one or more failed events. We accept up to 100 ids per call so
   * an ops mistake (re-queueing 50k rows by accident) can't flood the worker.
   * `resetAttempts=true` is an escape hatch for cases where the original
   * failure was infrastructure-side (e.g. consumer was down) and we want a
   * full retry budget — defaults to false so a poison-pill event still
   * eventually re-fails and stays in DLQ.
   */
  async requeue(ids: string[], opts: { resetAttempts?: boolean } = {}) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException("ids[] must contain at least one event id");
    }
    if (ids.length > 100) {
      throw new BadRequestException("Maximum 100 events per requeue call");
    }
    const result = await this.prisma.outboxEvent.updateMany({
      where: { id: { in: ids }, status: "failed" },
      data: {
        status: "queued",
        nextAttemptAt: new Date(),
        lastError: null,
        ...(opts.resetAttempts ? { attempts: 0 } : {}),
      },
    });
    this.logger.log(
      `requeued ${result.count}/${ids.length} failed outbox events (resetAttempts=${!!opts.resetAttempts})`,
    );
    return { requeued: result.count, requested: ids.length };
  }
}
