import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { OutboxService } from "../../outbox/outbox.service";
import { captureSwallowedEmit } from "../../../common/observability/capture-swallowed-emit";
import { POLLING_PLATFORMS } from "../constants/platform-status-map";

/**
 * Versioned reconciliation-summary event. Kept local for the same reason as
 * DELIVERY_AUTO_DISABLED_EVENT (the central EventTypes registry is owned by the
 * outbox module). Rides the shared durable outbox so a notification / ops
 * consumer can surface drift without coupling to this module.
 */
export const DELIVERY_RECONCILIATION_EVENT = "delivery.reconciliation.v1";

/**
 * How stale a sync timestamp may get before we flag it. Order polling runs on a
 * 15-20s cadence (PLATFORM_POLL_INTERVALS), so an enabled polling config whose
 * lastOrderPollAt is older than this has effectively stopped ingesting — almost
 * always because the circuit breaker tripped or the token can't refresh.
 *
 * Menu sync is operator-driven (no scheduler pushes it), so its staleness bar
 * is far more lenient: a stale menu is informational, not an outage.
 */
const ORDER_POLL_STALE_MS = 60 * 60 * 1000; // 1 hour
const MENU_SYNC_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Window over which we count internal DELIVERY orders per config for the
 * count-drift readout. A full day of orders is the natural granularity for a
 * daily reconciliation run.
 */
const ORDER_COUNT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ConfigReconciliation {
  configId: string;
  tenantId: string;
  platform: string;
  branchId: string | null;
  environment: string;
  /** Most recent successful order poll, or null if never polled. */
  lastOrderPollAt: string | null;
  lastMenuSyncAt: string | null;
  /** Enabled polling config whose lastOrderPollAt is older than the bar. */
  orderPollStale: boolean;
  /** Menu hasn't been synced within the lenient menu bar. */
  menuSyncStale: boolean;
  /** Internal DELIVERY orders ingested for this platform in the window. */
  internalOrdersInWindow: number;
  /**
   * Of those, how many carry no externalOrderId. A delivery-sourced order with
   * no platform id can't be status-synced back to the platform — a real drift
   * between what we hold and what the platform expects.
   */
  ordersMissingExternalId: number;
  /** Current circuit-breaker error count (context for a stale poll). */
  errorCount: number;
  lastError: string | null;
}

export interface ReconciliationSummary {
  scannedConfigs: number;
  driftedConfigs: number;
  details: ConfigReconciliation[];
  ranAt: string;
}

/**
 * Low-frequency drift reconciliation for delivery-platform configs.
 *
 * No adapter exposes a settlement / order-report pull, so we can't compare
 * platform-side order counts against ours. Instead this does the two checks we
 * CAN do authoritatively from our own state:
 *
 *  1. Staleness — an enabled polling config whose lastOrderPollAt has gone
 *     cold (breaker tripped, token dead, restaurant left closed) so orders
 *     have silently stopped; and a menu that hasn't synced in a long while.
 *  2. Count drift — internal DELIVERY orders ingested in the window, and how
 *     many lack an externalOrderId (un-syncable back to the platform).
 *
 * Findings are logged and rolled into a single delivery.reconciliation.v1
 * outbox summary so an ops/notification consumer can surface them. The job
 * NEVER mutates config or order state — it is read-only by design.
 */
@Injectable()
export class DeliveryReconciliationService {
  private readonly logger = new Logger(DeliveryReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    // OutboxModule is @Global; @Optional() so a bare-constructed unit test or a
    // missing bus can never break the (read-only, best-effort) reconciliation.
    @Optional() private readonly outbox?: OutboxService,
  ) {}

  /**
   * Run one reconciliation pass over all enabled, non-deleted configs.
   * Returns the summary (also emitted on the outbox) so the scheduler — and
   * tests — can assert on it.
   */
  async reconcile(now: Date = new Date()): Promise<ReconciliationSummary> {
    const configs = await this.prisma.deliveryPlatformConfig.findMany({
      where: { isEnabled: true, deletedAt: null },
    });

    const details: ConfigReconciliation[] = [];
    for (const config of configs) {
      details.push(await this.reconcileConfig(config, now));
    }

    const drifted = details.filter(
      (d) =>
        d.orderPollStale || d.menuSyncStale || d.ordersMissingExternalId > 0,
    );

    const summary: ReconciliationSummary = {
      scannedConfigs: configs.length,
      driftedConfigs: drifted.length,
      details: drifted, // only carry the drifted rows in the event payload
      ranAt: now.toISOString(),
    };

    if (drifted.length > 0) {
      // Loud per-config log so the drift is visible in the app logs even if no
      // notification consumer is wired yet.
      for (const d of drifted) {
        this.logger.warn(
          `Delivery drift: ${d.platform} config ${d.configId} (tenant=${d.tenantId}) ` +
            `pollStale=${d.orderPollStale} menuStale=${d.menuSyncStale} ` +
            `ordersMissingExternalId=${d.ordersMissingExternalId} ` +
            `lastPoll=${d.lastOrderPollAt ?? "never"} errorCount=${d.errorCount}`,
        );
      }
      await this.emitSummary(summary);
    } else {
      this.logger.log(
        `Delivery reconciliation: ${configs.length} configs scanned, no drift`,
      );
    }

    return summary;
  }

  private async reconcileConfig(
    config: {
      id: string;
      tenantId: string;
      platform: string;
      branchId: string | null;
      environment: string;
      lastOrderPollAt: Date | null;
      lastMenuSyncAt: Date | null;
      errorCount: number;
      lastError: string | null;
    },
    now: Date,
  ): Promise<ConfigReconciliation> {
    // Only polling platforms have an automated poll heartbeat; webhook-driven
    // platforms (e.g. YEMEKSEPETI) never set lastOrderPollAt, so a null there
    // is expected and must NOT be flagged as stale.
    const isPollingPlatform = (POLLING_PLATFORMS as readonly string[]).includes(
      config.platform,
    );
    const orderPollStale =
      isPollingPlatform &&
      (!config.lastOrderPollAt ||
        now.getTime() - config.lastOrderPollAt.getTime() > ORDER_POLL_STALE_MS);

    const menuSyncStale =
      !config.lastMenuSyncAt ||
      now.getTime() - config.lastMenuSyncAt.getTime() > MENU_SYNC_STALE_MS;

    const windowStart = new Date(now.getTime() - ORDER_COUNT_WINDOW_MS);
    const [internalOrdersInWindow, ordersMissingExternalId] = await Promise.all(
      [
        this.prisma.order.count({
          where: {
            tenantId: config.tenantId,
            source: config.platform,
            createdAt: { gte: windowStart },
          },
        }),
        this.prisma.order.count({
          where: {
            tenantId: config.tenantId,
            source: config.platform,
            createdAt: { gte: windowStart },
            externalOrderId: null,
          },
        }),
      ],
    );

    return {
      configId: config.id,
      tenantId: config.tenantId,
      platform: config.platform,
      branchId: config.branchId,
      environment: config.environment,
      lastOrderPollAt: config.lastOrderPollAt?.toISOString() ?? null,
      lastMenuSyncAt: config.lastMenuSyncAt?.toISOString() ?? null,
      orderPollStale,
      menuSyncStale,
      internalOrdersInWindow,
      ordersMissingExternalId,
      errorCount: config.errorCount,
      lastError: config.lastError,
    };
  }

  private async emitSummary(summary: ReconciliationSummary): Promise<void> {
    // Day-bucketed idempotency key so a same-day re-run (manual trigger, or a
    // second replica that loses the advisory lock race after the winner ran)
    // doesn't double-notify.
    const dayBucket = summary.ranAt.slice(0, 10); // YYYY-MM-DD
    await this.outbox
      ?.append({
        type: DELIVERY_RECONCILIATION_EVENT,
        // Tenant-wide operational summary — not scoped to one tenant.
        tenantId: null,
        payload: summary as unknown as Record<string, unknown>,
        idempotencyKey: `delivery-reconciliation:${dayBucket}`,
      })
      .catch(
        captureSwallowedEmit(this.logger, {
          module: "delivery-platforms",
          op: "reconciliation",
        }),
      );
  }
}
