import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PrismaService } from "../../../prisma/prisma.service";
import { DeliveryModerationService } from "../services/delivery-moderation.service";
import { OrderStatus } from "../../../common/constants/order-status.enum";
import { withAdvisoryLock } from "../../../common/scheduling/advisory-lock";

/**
 * Minutes a delivery order may sit in PENDING_APPROVAL before it is auto-
 * rejected. Overridable per deploy via DELIVERY_APPROVAL_TIMEOUT_MINUTES; set
 * to 0 to disable the sweep entirely.
 */
export const DEFAULT_APPROVAL_TIMEOUT_MINUTES = 15;

/** Bound the work per tick so a backlog burst can't monopolise a replica. */
const MAX_PER_TICK = 100;

/**
 * Auto-rejects delivery-platform orders that no operator has approved within
 * the timeout window.
 *
 * An order lands in PENDING_APPROVAL only when something needs human judgment:
 * the config has autoAccept=false, an item is unmapped, or the platform total
 * doesn't reconcile (see DeliveryOrderService.processIncomingOrder). Left
 * unattended it's a ghost order — the customer waits on food that will never
 * be made and the platform can't settle. Auto-*accepting* it would push a
 * possibly-wrong basket (no recipe → no stock deduction, or a bad total) into
 * the kitchen unreviewed, so the safe default is to REJECT: the platform is
 * told to cancel (customer gets a fast refund) and the internal Order moves to
 * CANCELLED.
 *
 * We reuse DeliveryModerationService.rejectOrder verbatim — it owns the
 * platform-first contract (never fabricate platform success), the audit log,
 * the circuit-breaker bump, and reject idempotency. This cron only decides
 * WHICH orders are stale and hands each to that method.
 */
@Injectable()
export class DeliveryApprovalTimeoutScheduler {
  private readonly logger = new Logger(DeliveryApprovalTimeoutScheduler.name);
  // Same-pod overlap guard: the advisory lock coordinates across replicas but
  // doesn't help if a single pod's tick overruns the 60s interval.
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: DeliveryModerationService,
  ) {}

  @Interval(60_000) // every minute
  async rejectStaleApprovals(): Promise<void> {
    const minutes = this.thresholdMinutes();
    if (minutes <= 0) {
      // Escape hatch: DELIVERY_APPROVAL_TIMEOUT_MINUTES=0 disables auto-reject
      // (e.g. a tenant that insists on manual-only moderation). Bail before we
      // even touch the DB / advisory lock.
      return;
    }
    if (this.isRunning) {
      this.logger.debug(
        "Previous approval-timeout tick still running, skipping",
      );
      return;
    }
    this.isRunning = true;
    try {
      await withAdvisoryLock(
        this.prisma,
        "delivery-approval-timeout",
        () => this.runOnce(minutes),
        this.logger,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async runOnce(minutes: number): Promise<void> {
    const cutoff = new Date(Date.now() - minutes * 60_000);
    const stale = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING_APPROVAL,
        requiresApproval: true,
        // Delivery-platform orders only — a restaurant's own PENDING_APPROVAL
        // (source null) is never auto-rejected by this cron.
        source: { not: null },
        externalOrderId: { not: null },
        createdAt: { lt: cutoff },
      },
      select: { id: true, tenantId: true, source: true, createdAt: true },
      take: MAX_PER_TICK,
      orderBy: { createdAt: "asc" }, // oldest ghosts first
    });
    if (stale.length === 0) return;

    const reason = `Sipariş ${minutes} dakika içinde onaylanmadı — otomatik iptal edildi`;
    let rejected = 0;
    for (const order of stale) {
      try {
        // Race guard: an operator may have Accepted this order (→ PENDING,
        // requiresApproval=false) between the findMany snapshot above and now.
        // rejectOrder would still reject a PENDING order, so re-read and skip
        // anything no longer sitting in PENDING_APPROVAL. (A sub-millisecond
        // TOCTOU vs rejectOrder's own re-resolve remains, but at a 15-minute
        // horizon with 60s ticks it's negligible.)
        const fresh = await this.prisma.order.findUnique({
          where: { id: order.id },
          select: { status: true },
        });
        if (!fresh || fresh.status !== OrderStatus.PENDING_APPROVAL) {
          continue;
        }

        await this.moderation.rejectOrder(order.tenantId, order.id, reason);
        rejected += 1;
      } catch (error: any) {
        // One platform/HTTP failure must not block the rest of the backlog.
        // moderation.rejectOrder has already logged the failure and bumped the
        // circuit breaker; we just move on to the next stale order.
        this.logger.warn(
          `Auto-reject failed for ${order.source} order ${order.id} (tenant ${order.tenantId}): ${error?.message ?? error}`,
        );
      }
    }

    if (rejected > 0) {
      this.logger.log(
        `Auto-rejected ${rejected}/${stale.length} delivery order(s) unapproved for >${minutes} min`,
      );
    }
  }

  /**
   * Resolve the timeout window from the environment, defaulting to
   * DEFAULT_APPROVAL_TIMEOUT_MINUTES. A missing, empty, non-numeric, or
   * negative value falls back to the default; 0 is honoured as "disabled".
   * Read per-tick so an ops change takes effect without a restart.
   */
  private thresholdMinutes(): number {
    const raw = process.env.DELIVERY_APPROVAL_TIMEOUT_MINUTES;
    if (raw === undefined || raw.trim() === "") {
      return DEFAULT_APPROVAL_TIMEOUT_MINUTES;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return DEFAULT_APPROVAL_TIMEOUT_MINUTES;
    }
    return Math.floor(n);
  }
}
