import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { KdsGateway } from '../../kds/kds.gateway';

/**
 * Per-tenant in-memory cooldown to prevent alert fatigue: every hourly
 * cron tick used to re-emit an alert for the same low-stock items, even
 * when nothing changed. Now we only emit when the SET of alert-eligible
 * items changed (a new item dropped below threshold, or an existing one
 * recovered) OR after `RE_ALERT_INTERVAL_MS` if the operator hasn't
 * fixed anything (so the alert still gets a daily nudge).
 *
 * The state is process-local — a multi-replica deployment will see one
 * extra alert per replica per change, which is acceptable. The
 * pg_advisory_lock on the scheduler still prevents two replicas from
 * BOTH running the check on the same tick.
 *
 * On restart, the cache resets and the first tick re-emits — also
 * acceptable, that's the natural "did I miss anything while we were
 * down" behavior.
 */
const RE_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const itemSetSignature = (ids: string[]): string => [...ids].sort().join(',');

interface AlertState {
  signature: string;
  emittedAt: number;
}

@Injectable()
export class StockAlertsService {
  private readonly logger = new Logger(StockAlertsService.name);

  // tenantId -> last alert signature + when we sent it
  private readonly lowStockState = new Map<string, AlertState>();
  private readonly expiringBatchesState = new Map<string, AlertState>();

  constructor(
    private prisma: PrismaService,
    @Optional()
    @Inject(forwardRef(() => KdsGateway))
    private kdsGateway?: KdsGateway,
  ) {}

  async checkLowStock(tenantId: string) {
    const lowStockItems = await this.prisma.$queryRaw<any[]>`
      SELECT si.id, si.name, si.unit, si."currentStock", si."minStock", sic.name as "categoryName"
      FROM stock_items si
      LEFT JOIN stock_item_categories sic ON si."categoryId" = sic.id
      WHERE si."tenantId" = ${tenantId}
        AND si."isActive" = true
        AND si."currentStock" <= si."minStock"
      ORDER BY si."currentStock" ASC
    `;

    if (this.shouldEmitAlert(this.lowStockState, tenantId, lowStockItems.map((i) => i.id))
        && lowStockItems.length > 0
        && this.kdsGateway?.server) {
      this.kdsGateway.server
        .to(`kitchen-${tenantId}`)
        .to(`pos-${tenantId}`)
        .emit('stock:low-alert', {
          count: lowStockItems.length,
          items: lowStockItems.map((i) => ({
            id: i.id,
            name: i.name,
            unit: i.unit,
            currentStock: i.currentStock,
            minStock: i.minStock,
          })),
        });
      this.logger.log(`Low stock alert sent for tenant ${tenantId}: ${lowStockItems.length} items`);
    }

    return lowStockItems;
  }

  async checkExpiringBatches(tenantId: string, days?: number) {
    const settings = await this.prisma.stockSettings.findUnique({
      where: { tenantId },
    });
    const alertDays = days || settings?.lowStockAlertDays || 3;

    const alertDate = new Date();
    alertDate.setDate(alertDate.getDate() + alertDays);

    const expiringBatches = await this.prisma.stockBatch.findMany({
      where: {
        tenantId,
        quantity: { gt: 0 },
        expiryDate: { lte: alertDate, gte: new Date() },
      },
      include: { stockItem: { select: { id: true, name: true, unit: true } } },
      orderBy: { expiryDate: 'asc' },
    });

    if (this.shouldEmitAlert(this.expiringBatchesState, tenantId, expiringBatches.map((b) => b.id))
        && expiringBatches.length > 0
        && this.kdsGateway?.server) {
      this.kdsGateway.server
        .to(`kitchen-${tenantId}`)
        .to(`pos-${tenantId}`)
        .emit('stock:expiry-alert', {
          count: expiringBatches.length,
          batches: expiringBatches.map((b) => ({
            id: b.id,
            stockItemName: b.stockItem.name,
            quantity: b.quantity,
            expiryDate: b.expiryDate,
          })),
        });
      this.logger.log(`Expiry alert sent for tenant ${tenantId}: ${expiringBatches.length} batches`);
    }

    return expiringBatches;
  }

  /**
   * True when the current item set differs from the last-emitted set
   * for this tenant, OR when RE_ALERT_INTERVAL_MS has elapsed since
   * the last emit (so the operator gets a daily reminder if they
   * haven't fixed things). Records the new state on emit.
   */
  private shouldEmitAlert(
    state: Map<string, AlertState>,
    tenantId: string,
    itemIds: string[],
  ): boolean {
    const signature = itemSetSignature(itemIds);
    const previous = state.get(tenantId);
    const now = Date.now();

    // Empty set + no previous emit = nothing to do.
    if (signature === '' && !previous) return false;

    // Set changed (new item dropped below threshold, or one recovered) = emit.
    if (!previous || previous.signature !== signature) {
      if (signature !== '') {
        state.set(tenantId, { signature, emittedAt: now });
      } else {
        // All items recovered — drop the cache entry so a fresh problem
        // re-emits immediately rather than waiting for the next change.
        state.delete(tenantId);
      }
      return signature !== '';
    }

    // Same items still problematic — nudge once per RE_ALERT_INTERVAL.
    if (now - previous.emittedAt >= RE_ALERT_INTERVAL_MS) {
      state.set(tenantId, { signature, emittedAt: now });
      return true;
    }

    return false;
  }
}
