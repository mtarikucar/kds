import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  Optional,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { OrderStatus } from "../../common/constants/order-status.enum";
import {
  validateTransition,
  canTransition,
} from "../../common/utils/order-state-machine";
import { OrderItemStatus } from "./dto/update-order-item-status.dto";
import { KdsGateway } from "./kds.gateway";
import { DeliveryStatusSyncService } from "../delivery-platforms/services/delivery-status-sync.service";
import { StockDeductionService } from "../stock-management/services/stock-deduction.service";
import { OrdersService } from "../orders/services/orders.service";
import { BranchScope, branchScope } from "../../common/scoping/branch-scope";
import { MetricsService } from "../../common/metrics/metrics.service";
import { OutboxService } from "../outbox/outbox.service";
import { captureSwallowedEmit } from "../../common/observability/capture-swallowed-emit";
import { toIntCents } from "../../common/money/to-int-cents";

@Injectable()
export class KdsService {
  private readonly logger = new Logger(KdsService.name);

  constructor(
    private prisma: PrismaService,
    private kdsGateway: KdsGateway,
    @Optional()
    @Inject(forwardRef(() => DeliveryStatusSyncService))
    private deliveryStatusSync?: DeliveryStatusSyncService,
    @Optional()
    @Inject(forwardRef(() => StockDeductionService))
    private stockDeductionService?: StockDeductionService,
    // Optional so unit tests constructing the service bare keep working.
    @Optional() private readonly metrics?: MetricsService,
    // OutboxModule is @Global — Optional() because unit tests construct the
    // service directly without an outbox mock. When absent the durable emit
    // silently no-ops; the live kdsGateway WebSocket broadcast (below) still
    // fires, so the KDS UI keeps updating. Mesh-side consumers (kds-routing
    // physical-device fan-out, marketing relay) only see KDS-originated
    // transitions when the outbox is wired in production.
    @Optional() private readonly outbox?: OutboxService,
    // For finished-good (Product.currentStock) reversal on KDS-side cancel —
    // this is a second cancel route (separate from OrdersService.updateStatus)
    // and must restore product stock too, or stockTracked sales leak here.
    // Appended LAST so positional bare-construction in unit specs is unaffected.
    @Optional()
    @Inject(forwardRef(() => OrdersService))
    private ordersService?: OrdersService,
  ) {}

  /**
   * Durable outbox emit for a KDS-originated order status transition.
   *
   * KdsService writes order status directly + broadcasts an ephemeral
   * kdsGateway WebSocket signal — but a crash right after the status commit
   * would lose that signal, so outbox consumers (kds-routing physical-device
   * fan-out, marketing relay) would miss the transition entirely. This
   * appends a durable `order.updated.v1 / order.completed.v1 /
   * order.cancelled.v1` AFTER the committed write, mirroring the
   * OrdersService.emitOrderEvent payload shape (orderId/tenantId/branchId/
   * tableId/status/totalCents via the integer-cents convention).
   *
   * Best-effort: failures are routed through captureSwallowedEmit so they
   * log at warn + capture to Sentry but never undo the committed status —
   * the live WS broadcast remains the source of truth for the UI.
   */
  private emitOrderEvent(
    type: "order.updated.v1" | "order.completed.v1" | "order.cancelled.v1",
    order: any,
  ): void {
    if (!this.outbox) return;
    this.outbox
      .append({
        type,
        tenantId: order?.tenantId,
        payload: {
          orderId: order?.id,
          tenantId: order?.tenantId,
          branchId: order?.branchId ?? null,
          tableId: order?.tableId ?? null,
          status: order?.status,
          totalCents: toIntCents(order?.finalAmount),
        },
      })
      .catch(captureSwallowedEmit(this.logger, { module: "kds", op: type }));
  }

  async getKitchenOrders(scope: BranchScope) {
    // Get orders that are in kitchen workflow (PENDING, PREPARING, READY).
    // A kitchen display belongs to ONE branch — scope the read by the
    // compound (tenantId, branchId) predicate so a terminal on branch A
    // never sees branch B's tickets.
    //
    // Hard cap at 200 — a kitchen display showing more than that is
    // unusable anyway, and the limit prevents a runaway tenant whose
    // orders accumulated due to misuse (e.g. status never moved) from
    // pulling MB of nested product JSON on every reconnect.
    return this.prisma.order.findMany({
      where: {
        ...branchScope(scope),
        status: {
          in: [OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY],
        },
      },
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                image: true,
                categoryId: true,
              },
            },
          },
        },
        table: {
          select: {
            id: true,
            number: true,
            section: true,
          },
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
  }

  async updateOrderStatus(scope: BranchScope, id: string, status: OrderStatus) {
    // Verify order exists and belongs to this tenant AND branch — a
    // kitchen display is pinned to one branch, so an id from another
    // branch must read as not-found rather than be mutable.
    const order = await this.prisma.order.findFirst({
      where: {
        id,
        ...branchScope(scope),
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    // Prevent status updates for orders awaiting approval
    if (
      order.requiresApproval &&
      order.status === OrderStatus.PENDING_APPROVAL
    ) {
      throw new BadRequestException(
        "Order requires approval before status can be changed. Please approve the order first.",
      );
    }

    // Validate state transition using state machine (STRICT mode)
    validateTransition(order.status as OrderStatus, status);

    // Build update data with status timestamps
    const updateData: any = { status };
    if (status === OrderStatus.PREPARING) updateData.preparingAt = new Date();
    if (status === OrderStatus.READY) updateData.readyAt = new Date();
    if (status === OrderStatus.CANCELLED) updateData.cancelledAt = new Date();

    // Compound WHERE on the original status closes the TOCTOU window
    // between the read above and the write here. Without it, kitchen and
    // waiter clicking simultaneously could each pass validateTransition
    // against PENDING and end up overwriting each other's status — the
    // last write would win silently while only one of the preparingAt /
    // readyAt timestamps got set.
    const claim = await this.prisma.order.updateMany({
      where: { id, ...branchScope(scope), status: order.status },
      data: updateData,
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Order status changed concurrently — refresh and retry.",
      );
    }
    const updatedOrder = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
        table: true,
      },
    });

    // Trigger stock deduction at the configured status (if applicable)
    if (this.stockDeductionService) {
      try {
        const result = await this.stockDeductionService.deductForOrder(
          id,
          scope.tenantId,
          status,
        );
        if (result?.lowStockAlerts?.length) {
          this.kdsGateway.emitLowStockAlert(
            scope.tenantId,
            order.branchId,
            result.lowStockAlerts,
          );
        }
      } catch (error: any) {
        this.logger.error(
          `Stock deduction failed for order ${id}: ${error.message}`,
          error.stack,
        );
      }
    }

    // Emit status change via WebSocket
    this.kdsGateway.emitOrderStatusChange(
      scope.tenantId,
      order.branchId,
      id,
      status,
    );

    // Durable outbox emit AFTER the committed status write, alongside (NOT
    // instead of) the live WS broadcast above. Mirrors OrdersService.updateStatus
    // event-type mapping: PAID/SERVED are the terminal non-cancel statuses →
    // "completed", CANCELLED → "cancelled", everything else → "updated". The
    // kds-routing mesh consumer dispatches a clear_order command on the
    // terminal transitions.
    const eventType =
      status === OrderStatus.PAID || status === OrderStatus.SERVED
        ? "order.completed.v1"
        : status === OrderStatus.CANCELLED
          ? "order.cancelled.v1"
          : "order.updated.v1";
    this.emitOrderEvent(eventType, updatedOrder);

    // Sync status to delivery platform (if applicable)
    this.deliveryStatusSync?.syncStatusToPlatform(id, status).catch((err) => {
      this.logger.error(
        `Delivery platform sync failed for order ${id}: ${err.message}`,
      );
    });

    // Track 2 — record the committed ticket status transition for
    // Prometheus. After the committed status write + side effects, optional
    // + ?.-guarded so it can never break the business write. `status` is
    // the developer-controlled OrderStatus enum (never user input), so
    // cardinality stays bounded.
    this.metrics?.incCounter(
      "kds_ticket_status_total",
      "KDS ticket status transitions by status",
      { status },
    );

    return updatedOrder;
  }

  async updateOrderItemStatus(
    scope: BranchScope,
    itemId: string,
    status: OrderItemStatus,
  ) {
    // Iter-91: itemId comes from the URL path; the body no longer carries
    // a duplicate `orderItemId` field that could desync from the URL.
    //
    // Scope the lookup by the compound (tenantId, branchId) at the DB
    // boundary — via the parent `order` relation — rather than relying on
    // a post-fetch check. Prevents cross-branch/cross-tenant probing via
    // timing differences and removes a TOCTOU window.
    const orderItem = await this.prisma.orderItem.findFirst({
      where: { id: itemId, order: { ...branchScope(scope) } },
      include: { order: true },
    });

    if (!orderItem) {
      throw new NotFoundException(`Order item with ID ${itemId} not found`);
    }

    // Compound WHERE on the original status + branch scope — mirrors the
    // TOCTOU guard `updateOrderStatus` / `cancelOrder` use. Without it,
    // two KDS terminals clicking the same item at once would both pass
    // the implicit findFirst check and both succeed; whichever wrote
    // last wins silently. Defence-in-depth IDOR on (tenantId, branchId)
    // too.
    const claim = await this.prisma.orderItem.updateMany({
      where: {
        id: itemId,
        order: { ...branchScope(scope) },
        status: orderItem.status,
      },
      data: { status },
    });
    if (claim.count === 0) {
      throw new BadRequestException(
        "Item status changed concurrently — refresh and retry.",
      );
    }
    const updatedOrderItem = await this.prisma.orderItem.findUniqueOrThrow({
      where: { id: itemId },
      include: {
        product: true,
        order: true,
      },
    });

    const allItems = await this.prisma.orderItem.findMany({
      where: { orderId: orderItem.orderId, order: { ...branchScope(scope) } },
      select: { status: true },
    });

    const allReady = allItems.every(
      (item) => item.status === OrderItemStatus.READY,
    );
    // deep-review H11/M17: when the kitchen bumps the LAST item to READY,
    // auto-promote the ticket — but the state machine forbids PENDING→READY
    // directly, and the item write above is ALREADY committed (no enclosing
    // $transaction). The old code called updateOrderStatus(PENDING→READY)
    // unconditionally, which threw a 400 from validateTransition AFTER the
    // item committed, leaving the ticket stuck/lost on the KDS even though
    // every item is done. Two fixes:
    //   1) Bridge the intermediate hop: PENDING needs a PREPARING step first
    //      so READY becomes reachable (driven by canTransition, not hardcoded).
    //   2) Make the promotion fault-tolerant — guard with canTransition AND
    //      swallow a still-invalid transition so the item bump itself always
    //      succeeds (the WS emit below must fire) instead of bubbling a 400.
    // An order in PENDING_APPROVAL must NEVER auto-promote, regardless of the
    // requiresApproval flag.
    const cur = orderItem.order.status as OrderStatus;
    if (
      allReady &&
      cur !== OrderStatus.READY &&
      cur !== OrderStatus.PENDING_APPROVAL
    ) {
      try {
        // PENDING has no direct edge to READY — hop through PREPARING first.
        if (cur === OrderStatus.PENDING) {
          await this.updateOrderStatus(
            scope,
            orderItem.orderId,
            OrderStatus.PREPARING,
          );
        }
        // Only promote if READY is now reachable from the order's CURRENT
        // (post-hop) status; otherwise skip silently rather than throw.
        const fresh = await this.prisma.order.findUnique({
          where: { id: orderItem.orderId },
          select: { status: true },
        });
        if (
          fresh &&
          canTransition(fresh.status as OrderStatus, OrderStatus.READY)
        ) {
          await this.updateOrderStatus(
            scope,
            orderItem.orderId,
            OrderStatus.READY,
          );
        }
      } catch (error: any) {
        // The item bump itself succeeded and is committed; a failed/raced
        // auto-promotion (invalid transition, concurrent-change claim, etc.)
        // must not surface a 400 to the KDS — log and let the WS emit fire so
        // the screen still updates. A waiter/kitchen can advance the ticket.
        this.logger.warn(
          `KDS auto-promotion to READY skipped for order ${orderItem.orderId}: ${error?.message}`,
        );
      }
    }

    this.kdsGateway.emitOrderItemStatusChange(
      scope.tenantId,
      updatedOrderItem.order.branchId,
      itemId,
      status,
    );

    // Track 2 — record the committed item status transition for Prometheus.
    // After the committed item write + side effects, optional + ?.-guarded
    // so it can never break the business write. `status` is the
    // developer-controlled OrderItemStatus enum (never user input).
    this.metrics?.incCounter(
      "kds_ticket_item_status_total",
      "KDS ticket item status transitions by status",
      { status },
    );

    return updatedOrderItem;
  }

  async cancelOrder(scope: BranchScope, id: string) {
    // Verify order exists and belongs to this tenant AND branch — an id
    // from a sibling branch must read as not-found, never be cancellable.
    const order = await this.prisma.order.findFirst({
      where: {
        id,
        ...branchScope(scope),
      },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    // Validate state transition using state machine (STRICT mode)
    // This handles PAID and CANCELLED terminal states
    validateTransition(order.status as OrderStatus, OrderStatus.CANCELLED);

    // Compound WHERE on the original status guards the same TOCTOU window
    // as updateOrderStatus — a concurrent transition (e.g. status moves to
    // PAID between the read and the write) must not be silently overwritten
    // by a stale CANCELLED claim.
    const cancelClaim = await this.prisma.order.updateMany({
      where: { id, ...branchScope(scope), status: order.status },
      data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
    });
    if (cancelClaim.count === 0) {
      throw new BadRequestException(
        "Order status changed concurrently — refresh and retry.",
      );
    }
    const updatedOrder = await this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: {
        orderItems: {
          include: {
            product: true,
          },
        },
        table: true,
      },
    });

    // Reverse finished-good (Product.currentStock) deductions — this KDS cancel
    // route is independent of OrdersService.updateStatus and would otherwise
    // leak stockTracked stock on a POS-created order cancelled from the KDS.
    // Idempotent + best-effort.
    if (this.ordersService) {
      try {
        await this.ordersService.reverseProductStockForOrder(
          id,
          scope.tenantId,
        );
      } catch (error: any) {
        this.logger.error(
          `Product stock reversal failed for cancelled order ${id}: ${error.message}`,
        );
      }
    }

    // Reverse ingredient deductions on cancellation
    if (this.stockDeductionService) {
      try {
        await this.stockDeductionService.reverseForOrder(id, scope.tenantId);
      } catch (error: any) {
        this.logger.error(
          `CRITICAL: Stock reversal failed for cancelled order ${id}. Manual stock adjustment may be needed. Error: ${error.message}`,
          error.stack,
        );
      }
    }

    // Emit status change via WebSocket
    this.kdsGateway.emitOrderStatusChange(
      scope.tenantId,
      order.branchId,
      id,
      OrderStatus.CANCELLED,
    );

    // Durable outbox emit AFTER the committed cancel, alongside the live WS
    // broadcast above — a crash post-commit would otherwise lose the
    // KDS-originated cancellation and the kds-routing mesh would never clear
    // the screen / the marketing relay would never see it.
    this.emitOrderEvent("order.cancelled.v1", updatedOrder);

    // Sync cancellation to delivery platform (if applicable)
    this.deliveryStatusSync
      ?.syncStatusToPlatform(id, OrderStatus.CANCELLED)
      .catch((err) => {
        this.logger.error(
          `Delivery platform sync failed for order ${id}: ${err.message}`,
        );
      });

    return updatedOrder;
  }
}
