import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { MetricsService } from "../../../common/metrics/metrics.service";
import {
  PlatformLogDirection,
  PlatformLogAction,
} from "../constants/platform.enum";

export interface LogEntry {
  tenantId: string;
  branchId?: string;
  platform: string;
  direction: string;
  action: string;
  orderId?: string;
  externalId?: string;
  request?: any;
  response?: any;
  statusCode?: number;
  success: boolean;
  error?: string;
  maxRetries?: number;
  nextRetryAt?: Date;
}

@Injectable()
export class DeliveryLogService {
  private readonly logger = new Logger(DeliveryLogService.name);

  constructor(
    private prisma: PrismaService,
    // Optional so the many unit tests that construct this service bare keep
    // working and the audit/retry path never depends on the metrics registry
    // being wired — metrics must never break a delivery operation.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Canonical predicate for the delivery dead-letter terminal state.
   *
   * incrementRetry sets `nextRetryAt=null` exactly when
   * `retryCount>=maxRetries`; markRetrySuccess also nulls nextRetryAt but
   * flips `success=true`. So `success:false AND nextRetryAt:null` already
   * isolates the dead-letter set — the explicit `retryCount>=maxRetries`
   * (a Prisma column-to-column field reference) is kept as a belt-and-braces
   * guard so a future code path that nulls nextRetryAt for another reason
   * can't leak non-exhausted rows into the DLQ readout.
   */
  private deadLetterWhere(filters?: { tenantId?: string; platform?: string }) {
    return {
      success: false as const,
      nextRetryAt: null,
      retryCount: { gte: this.prisma.deliveryPlatformLog.fields.maxRetries },
      ...(filters?.tenantId ? { tenantId: filters.tenantId } : {}),
      ...(filters?.platform ? { platform: filters.platform } : {}),
    };
  }

  /**
   * Best-effort log write. Swallows errors so a transient DB hiccup in
   * the audit path cannot fail a successful order-create or make a
   * webhook retry loop with the platform — the caller has already done
   * the real work.
   */
  async log(entry: LogEntry) {
    try {
      // v3.0.0: branchId is NOT NULL on DeliveryPlatformLog. Derive from the
      // referenced order when possible; fall back to caller-provided branchId.
      let branchId = entry.branchId;
      if (!branchId && entry.orderId) {
        const order = await this.prisma.order.findUnique({
          where: { id: entry.orderId },
          select: { branchId: true },
        });
        branchId = order?.branchId ?? undefined;
      }
      if (!branchId) {
        this.logger.warn(
          `Cannot create delivery log without branchId (tenant=${entry.tenantId}, order=${entry.orderId ?? "n/a"})`,
        );
        return null;
      }
      return await this.prisma.deliveryPlatformLog.create({
        data: {
          tenantId: entry.tenantId,
          branchId,
          platform: entry.platform,
          direction: entry.direction,
          action: entry.action,
          orderId: entry.orderId,
          externalId: entry.externalId,
          request: entry.request || undefined,
          response: entry.response || undefined,
          statusCode: entry.statusCode,
          success: entry.success,
          error: entry.error,
          maxRetries: entry.maxRetries ?? 3,
          nextRetryAt: entry.nextRetryAt,
        },
      });
    } catch (error: any) {
      this.logger.warn(`Failed to create log entry: ${error.message}`);
      return null;
    }
  }

  /**
   * Strip attacker/customer-controlled PII before persisting a raw
   * webhook body. The platform's order id/token is kept for debugging;
   * personal identifiers are dropped so log-table retention doesn't
   * inadvertently turn into long-term PII storage.
   */
  scrubPii<T>(raw: T): unknown {
    if (raw == null || typeof raw !== "object") return raw;
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (/phone|email|address|customer|name|buyer|recipient|gsm/i.test(key)) {
        redacted[key] = "[redacted]";
      } else if (value && typeof value === "object") {
        redacted[key] = this.scrubPii(value);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  async getFailedOperations(limit = 50) {
    return this.prisma.deliveryPlatformLog.findMany({
      where: {
        success: false,
        retryCount: { lt: 3 },
        nextRetryAt: { lte: new Date() },
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }

  async incrementRetry(logId: string) {
    const log = await this.prisma.deliveryPlatformLog.findUnique({
      where: { id: logId },
    });
    if (!log) return;

    const nextRetryCount = log.retryCount + 1;
    const backoffMs = Math.min(60_000 * Math.pow(2, nextRetryCount), 3_600_000); // Max 1 hour
    const exhausted = nextRetryCount >= log.maxRetries;

    await this.prisma.deliveryPlatformLog.update({
      where: { id: logId },
      data: {
        retryCount: nextRetryCount,
        nextRetryAt: exhausted
          ? null // No more retries — this is the dead-letter terminal state.
          : new Date(Date.now() + backoffMs),
      },
    });

    // This row just crossed into the dead-letter terminal state
    // (nextRetryAt=null, retries exhausted). Bump the DLQ-depth gauge
    // inline so a Prometheus alert can fire between the periodic
    // authoritative re-syncs (dlqDepth()). Wrapped so a metrics hiccup
    // can never fail the retry-accounting write above.
    if (exhausted) {
      try {
        this.metrics?.incDeliveryDlqDepth();
      } catch {
        /* metrics must never break the retry path */
      }
    }
  }

  async markRetrySuccess(logId: string) {
    await this.prisma.deliveryPlatformLog.update({
      where: { id: logId },
      data: { success: true, nextRetryAt: null },
    });
  }

  async getLogs(
    tenantId: string,
    filters?: {
      platform?: string;
      success?: boolean;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: any = { tenantId };
    if (filters?.platform) where.platform = filters.platform;
    if (filters?.success !== undefined) where.success = filters.success;

    const [logs, total] = await Promise.all([
      this.prisma.deliveryPlatformLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: filters?.limit || 50,
        skip: filters?.offset || 0,
      }),
      this.prisma.deliveryPlatformLog.count({ where }),
    ]);

    return { logs, total };
  }

  // ========================================
  // Dead-letter queue (DLQ) readout + replay
  //
  // The terminal dead-letter state is `success:false AND nextRetryAt:null
  // AND retryCount>=maxRetries` — the state incrementRetry parks a row in
  // once it exhausts its retry budget. The RetryScheduler's
  // getFailedOperations() filters on `nextRetryAt <= now`, so a null
  // nextRetryAt row is never re-claimed: it sits dead until an operator
  // requeues it. These methods make that set visible and replayable
  // (mirrors SuperAdminOutboxService.listFailed/summary/requeue).
  // ========================================

  /**
   * Page through dead-lettered log rows. Cursor-paginated by id (desc) so an
   * ops dashboard can scroll a large backlog without OFFSET cost. Optional
   * tenantId/platform narrow the set; omitting tenantId is the SuperAdmin
   * cross-tenant readout.
   */
  async getDeadLetters(params: {
    tenantId?: string;
    platform?: string;
    limit?: number;
    cursor?: string;
  }) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const rows = await this.prisma.deliveryPlatformLog.findMany({
      where: this.deadLetterWhere(params),
      orderBy: { id: "desc" },
      take: limit + 1, // +1 to detect "more available" without a second query
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        tenantId: true,
        branchId: true,
        platform: true,
        direction: true,
        action: true,
        orderId: true,
        externalId: true,
        statusCode: true,
        error: true,
        retryCount: true,
        maxRetries: true,
        createdAt: true,
      },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  /**
   * Authoritative COUNT(*) of the dead-letter set. Also re-syncs the
   * `delivery_dlq_depth` gauge to the counted value — the inline inc() in
   * incrementRetry keeps it fresh between syncs, this corrects any drift
   * after an operator requeue/delete or a process restart.
   */
  async dlqDepth(filters?: {
    tenantId?: string;
    platform?: string;
  }): Promise<number> {
    const depth = await this.prisma.deliveryPlatformLog.count({
      where: this.deadLetterWhere(filters),
    });
    // Re-sync the gauge to the authoritative value. Only sync the GLOBAL
    // count (no filter) so a tenant-scoped read can't clobber the
    // process-wide gauge with a partial number.
    if (!filters?.tenantId && !filters?.platform) {
      try {
        this.metrics?.setDeliveryDlqDepth(depth);
      } catch {
        /* metrics must never break the read path */
      }
    }
    return depth;
  }

  /**
   * Re-queue dead-lettered rows for the EXISTING RetryScheduler: set
   * `nextRetryAt=new Date()` so the scheduler's next tick (getFailedOperations
   * filters `nextRetryAt <= now`) re-claims them — no new worker.
   *
   * Up to 100 ids per call so an ops mistake can't flood the scheduler. The
   * WHERE keeps the dead-letter predicate so a row that's since been requeued
   * or succeeded isn't touched twice. `resetAttempts=true` is an escape hatch
   * (infra-side outage) that zeroes retryCount for a full retry budget;
   * default FALSE so a poison-pill row keeps its exhausted counter and
   * re-DLQs after one more failed tick instead of looping forever.
   */
  async requeueDeadLetters(
    ids: string[],
    opts: { resetAttempts?: boolean; tenantId?: string } = {},
  ): Promise<{ requeued: number; requested: number }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException("ids[] must contain at least one log id");
    }
    if (ids.length > 100) {
      throw new BadRequestException(
        "Maximum 100 dead-letters per requeue call",
      );
    }
    const result = await this.prisma.deliveryPlatformLog.updateMany({
      where: {
        id: { in: ids },
        success: false,
        nextRetryAt: null,
        retryCount: { gte: this.prisma.deliveryPlatformLog.fields.maxRetries },
        // Tenant fence: a tenant-scoped controller passes its own tenantId so
        // an ADMIN can never replay another tenant's dead-letters by guessing
        // ids. Omitted only by the (cross-tenant) SuperAdmin path.
        ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      },
      data: {
        nextRetryAt: new Date(),
        ...(opts.resetAttempts ? { retryCount: 0 } : {}),
      },
    });
    this.logger.log(
      `requeued ${result.count}/${ids.length} delivery dead-letters (resetAttempts=${!!opts.resetAttempts})`,
    );
    // Rows just left the dead-letter set — refresh the gauge to the truth.
    await this.dlqDepth();
    return { requeued: result.count, requested: ids.length };
  }
}
