import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { KdsGateway } from "../../kds/kds.gateway";

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
const itemSetSignature = (ids: string[]): string => [...ids].sort().join(",");
// Dedup state is keyed per (tenant, branch): the hourly scheduler now runs
// once PER active branch, so two branches of the same tenant must not clobber
// each other's last-emitted signature. The branchId is always present on the
// emit path, so this key is always well-formed there.
const alertStateKey = (tenantId: string, branchId: string): string =>
  `${tenantId}:${branchId}`;

interface AlertState {
  signature: string;
  emittedAt: number;
}

@Injectable()
export class StockAlertsService {
  private readonly logger = new Logger(StockAlertsService.name);

  // `${tenantId}:${branchId}` -> last alert signature + when we sent it
  private readonly lowStockState = new Map<string, AlertState>();
  private readonly expiringBatchesState = new Map<string, AlertState>();

  constructor(
    private prisma: PrismaService,
    @Optional()
    @Inject(forwardRef(() => KdsGateway))
    private kdsGateway?: KdsGateway,
  ) {}

  // `branchId` is optional only for callers that want the raw list without an
  // emit. The hourly scheduler now iterates each tenant's ACTIVE branches and
  // passes a branchId (so the realtime emit fires — the branch-suffixed rooms
  // are the only ones sockets join); the branch-scoped dashboard likewise
  // passes its branchId. When supplied, the raw SQL gains
  // `AND si."branchId" = $branchId`.
  async checkLowStock(tenantId: string, branchId?: string) {
    const branchFilter = branchId
      ? Prisma.sql`AND si."branchId" = ${branchId}`
      : Prisma.empty;
    const lowStockItems = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT si.id, si.name, si.unit, si."currentStock", si."minStock", sic.name as "categoryName"
      FROM stock_items si
      LEFT JOIN stock_item_categories sic ON si."categoryId" = sic.id
      WHERE si."tenantId" = ${tenantId}
        ${branchFilter}
        AND si."isActive" = true
        AND si."currentStock" <= si."minStock"
      ORDER BY si."currentStock" ASC
    `);

    // Emit only when we have a branch to target — the realtime rooms are
    // branch-suffixed (kitchen/pos-${tenantId}-${branchId}); a bare-room emit
    // reaches zero clients. A branchId-less call (raw list for REST consumers)
    // simply skips the emit. The scheduler always supplies a branchId so its
    // hourly run does emit. The KDS/POS sockets now subscribe to
    // "stock:low-alert" (useKitchenSocket / usePosSocket) and show a warning
    // toast, so the emit actually surfaces on a screen.
    if (
      branchId &&
      lowStockItems.length > 0 &&
      this.kdsGateway &&
      this.shouldEmitAlert(
        this.lowStockState,
        alertStateKey(tenantId, branchId),
        lowStockItems.map((i) => i.id),
      )
    ) {
      this.kdsGateway.emitStockLowAlert(tenantId, branchId, {
        count: lowStockItems.length,
        items: lowStockItems.map((i) => ({
          id: i.id,
          name: i.name,
          unit: i.unit,
          currentStock: i.currentStock,
          minStock: i.minStock,
        })),
      });
      this.logger.log(
        `Low stock alert sent for tenant ${tenantId} branch ${branchId}: ${lowStockItems.length} items`,
      );
    }

    return lowStockItems;
  }

  // `branchId` optional only for raw-list callers — same emit rule as
  // checkLowStock (the scheduler passes a branchId per active branch so the
  // emit fires). When supplied, the batch query is fenced to that branch so
  // the expiry feed never surfaces another branch's batches.
  async checkExpiringBatches(
    tenantId: string,
    days?: number,
    branchId?: string,
  ) {
    // v3.0.1 — findFirst (compound-unique with branchId: null trips
    // Prisma client validation; see branch-scope helper note).
    const settings = await this.prisma.stockSettings.findFirst({
      where: { tenantId, branchId: null },
    });
    const alertDays = days || settings?.lowStockAlertDays || 3;

    const alertDate = new Date();
    alertDate.setDate(alertDate.getDate() + alertDays);

    const expiringBatches = await this.prisma.stockBatch.findMany({
      where: {
        tenantId,
        ...(branchId ? { branchId } : {}),
        quantity: { gt: 0 },
        expiryDate: { lte: alertDate, gte: new Date() },
      },
      include: { stockItem: { select: { id: true, name: true, unit: true } } },
      orderBy: { expiryDate: "asc" },
    });

    // Branch-targeted emit only (see checkLowStock). A branchId-less call
    // computes the list for REST without emitting to empty bare rooms.
    if (
      branchId &&
      expiringBatches.length > 0 &&
      this.kdsGateway &&
      this.shouldEmitAlert(
        this.expiringBatchesState,
        alertStateKey(tenantId, branchId),
        expiringBatches.map((b) => b.id),
      )
    ) {
      this.kdsGateway.emitStockExpiryAlert(tenantId, branchId, {
        count: expiringBatches.length,
        batches: expiringBatches.map((b) => ({
          id: b.id,
          stockItemName: b.stockItem.name,
          quantity: b.quantity,
          expiryDate: b.expiryDate,
        })),
      });
      this.logger.log(
        `Expiry alert sent for tenant ${tenantId} branch ${branchId}: ${expiringBatches.length} batches`,
      );
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
    key: string,
    itemIds: string[],
  ): boolean {
    const signature = itemSetSignature(itemIds);
    const previous = state.get(key);
    const now = Date.now();

    // Empty set + no previous emit = nothing to do.
    if (signature === "" && !previous) return false;

    // Set changed (new item dropped below threshold, or one recovered) = emit.
    if (!previous || previous.signature !== signature) {
      if (signature !== "") {
        state.set(key, { signature, emittedAt: now });
      } else {
        // All items recovered — drop the cache entry so a fresh problem
        // re-emits immediately rather than waiting for the next change.
        state.delete(key);
      }
      return signature !== "";
    }

    // Same items still problematic — nudge once per RE_ALERT_INTERVAL.
    if (now - previous.emittedAt >= RE_ALERT_INTERVAL_MS) {
      state.set(key, { signature, emittedAt: now });
      return true;
    }

    return false;
  }
}
