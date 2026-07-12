import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  Optional,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as crypto from "crypto";
import { PrismaService } from "../../../prisma/prisma.service";
import { KdsGateway } from "../../kds/kds.gateway";
import { AdapterFactory } from "../adapters/adapter-factory";
import { DeliveryLogService } from "./delivery-log.service";
import { DeliveryAuthService } from "./delivery-auth.service";
import { DeliveryConfigService } from "./delivery-config.service";
import { NormalizedOrder } from "../interfaces/platform-order.interface";
import {
  PlatformLogDirection,
  PlatformLogAction,
} from "../constants/platform.enum";
import { OrderStatus } from "../../../common/constants/order-status.enum";
import { CommandQueueService } from "../../device-mesh/command-queue.service";
import { EscPosBuilderService } from "../../device-mesh/printing/escpos-builder.service";
import { ReceiptSnapshotBuilder } from "../../orders/services/receipt-snapshot.builder";
import { OutboxService } from "../../outbox/outbox.service";
import { SalesInvoiceService } from "../../accounting/services/sales-invoice.service";
import { captureSwallowedEmit } from "../../../common/observability/capture-swallowed-emit";

/**
 * Versioned domain events for inbound delivery money/cart mutations. Kept
 * local for the same reason as DELIVERY_AUTO_DISABLED_EVENT /
 * DELIVERY_RECONCILIATION_EVENT — the central EventTypes registry is owned by
 * the outbox module, so OutboxService.append only logs a (harmless)
 * unregistered-type warning until they're added there. The events ride the
 * SAME durable outbox/in-process bus every other tenant signal uses, so a
 * notification / accounting consumer can subscribe without coupling to this
 * module.
 */
export const DELIVERY_ORDER_REFUNDED_EVENT = "delivery.order.refunded.v1";
export const DELIVERY_ORDER_AMENDED_EVENT = "delivery.order.amended.v1";

/**
 * Order statuses past which an amendment must be REFUSED — the kitchen has
 * already committed/served the order (or it's a terminal money state), so
 * mutating its items would desync the paper ticket / KDS hand-off from what
 * was actually cooked. The platform must instead cancel + re-order.
 */
const AMENDMENT_LOCKED_STATUSES: readonly OrderStatus[] = [
  OrderStatus.READY,
  OrderStatus.SERVED,
  OrderStatus.PAID,
  OrderStatus.CANCELLED,
];

/**
 * One recorded refund event on an Order's externalData blob. The internal
 * Order has NO dedicated refund column (see schema.prisma: Order has only
 * status/notes/externalData/finalAmount), and delivery orders never create
 * Payment rows (the platform owns the money), so this append-only ledger on
 * externalData.refunds[] is where partial-refund amounts are honestly
 * recorded. A full refund additionally moves the order to CANCELLED.
 */
interface RecordedRefund {
  /** Stable dedup key: platform refundId when supplied, else full|<amount>. */
  refundKey: string;
  type: "full" | "partial";
  amount: number | null;
  reason?: string;
  at: string;
}

@Injectable()
export class DeliveryOrderService {
  private readonly logger = new Logger(DeliveryOrderService.name);

  // Stateless, dependency-free snapshot builder (same one OrdersService uses).
  // Instantiated directly rather than injected so the delivery module doesn't
  // need to import OrdersModule (which itself forwardRef-imports this module —
  // adding the reverse edge would make the cycle harder to reason about for a
  // class that has no DI dependencies anyway).
  private readonly snapshotBuilder = new ReceiptSnapshotBuilder();

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => KdsGateway))
    private kdsGateway: KdsGateway,
    private adapterFactory: AdapterFactory,
    private logService: DeliveryLogService,
    private authService: DeliveryAuthService,
    private configService: DeliveryConfigService,
    private commandQueue: CommandQueueService,
    private escpos: EscPosBuilderService,
    // OutboxModule is @Global; @Optional() so the many unit tests that build
    // this service bare keep working and a missing bus can never break a
    // refund/amendment write path — the domain-event emit is best-effort.
    @Optional() private readonly outbox?: OutboxService,
    // @Optional for the same bare-unit-test reason; the credit-note emit on a
    // platform full-refund is best-effort and must never break the refund write.
    @Optional() private readonly salesInvoiceService?: SalesInvoiceService,
  ) {}

  /**
   * Process an incoming order from a delivery platform.
   * This is the heart of the system — handles deduplication, item mapping,
   * order creation, auto-accept, and WebSocket emission.
   */
  async processIncomingOrder(
    tenantId: string,
    normalizedOrder: NormalizedOrder,
  ) {
    const { platform, externalOrderId } = normalizedOrder;

    // Read config ONCE up front so the inside-txn `requiresApproval`
    // decision and the outside-txn platform-side accept decision use
    // the same snapshot. The earlier code re-read the config after
    // commit; if an admin toggled autoAccept in the few ms in between,
    // the order would be persisted as PENDING (autoAccept=true) but
    // the platform-side acceptOrder call would skip (autoAccept=false),
    // leaving the order in-kitchen while the platform thought it was
    // unaccepted.
    const config = await this.prisma.deliveryPlatformConfig.findUnique({
      where: { tenantId_platform: { tenantId, platform } },
    });
    const autoAccept = config?.isEnabled ? (config.autoAccept ?? false) : false;

    // branchId is NOT NULL on Order. Multi-branch routing: if the config names
    // a target branch (config.branchId) AND it is an active branch of THIS
    // tenant, the platform's orders route there. Otherwise we fall back to the
    // tenant's first active branch (legacy deterministic behaviour). The
    // tenant-scope + active check defends against a config whose branch was
    // re-assigned/retired or (defensively) points cross-tenant.
    let branchId: string | null = null;
    if (config?.branchId) {
      const mapped = await this.prisma.branch.findFirst({
        where: { id: config.branchId, tenantId, status: "active" },
        select: { id: true },
      });
      branchId = mapped?.id ?? null;
    }
    if (!branchId) {
      const fallbackBranch = await this.prisma.branch.findFirst({
        where: { tenantId, status: "active" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      branchId = fallbackBranch?.id ?? null;
    }
    if (!branchId) {
      this.logger.warn(
        `No active branch for tenant ${tenantId} — cannot persist ${platform} order ${externalOrderId}`,
      );
      return null;
    }

    // 1-4. Deduplicate + map items + create order in a transaction.
    // Final dedup guarantee is the partial unique index
    // orders(tenantId, source, externalOrderId) — the findFirst below is
    // a fast-path; the try/catch on P2002 handles concurrent webhooks.
    let createdOrder;
    try {
      createdOrder = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.order.findFirst({
          where: {
            tenantId,
            source: platform,
            externalOrderId,
          },
        });

        if (existing) {
          this.logger.debug(
            `Duplicate order skipped: ${platform} ${externalOrderId}`,
          );
          return null;
        }

        // 2-3. Map items + compute/validate totals (shared with the
        // amendment path so both honour the SAME drift-safe logic).
        const resolved = await this.resolveItemsAndTotals(
          tx,
          tenantId,
          platform,
          normalizedOrder,
        );
        const { validItems, unmappedItems, totalsMismatch } = resolved;

        // Config + autoAccept were resolved before the txn (iter-39) so
        // the inside-txn decision and the outside-txn platform-accept
        // decision agree on the same snapshot.

        // Generate order number
        const orderNumber = `${platform.substring(0, 3)}-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;

        // Calculate totals
        const totalAmount = normalizedOrder.totalAmount;
        const discount = normalizedOrder.discount;
        const finalAmount = normalizedOrder.finalAmount;

        const orderNotes = resolved.orderNotes;

        // 4. Create order
        // Also force approval when items are unmapped (a zero-line-item
        // order with autoAccept=true would otherwise pass at the platform
        // total with no kitchen-visible items) or when totals drift.
        const requiresApproval =
          !autoAccept || unmappedItems.length > 0 || totalsMismatch;
        const status = requiresApproval
          ? OrderStatus.PENDING_APPROVAL
          : OrderStatus.PENDING;

        return tx.order.create({
          data: {
            orderNumber,
            type: "DELIVERY",
            status,
            requiresApproval,
            source: platform,
            externalOrderId,
            // Raw payload stored for debugging, but PII (customer
            // name/phone/address) lives in dedicated columns already —
            // scrub it from the blob so log retention doesn't double as
            // long-term PII storage.
            externalData: this.logService.scrubPii(
              normalizedOrder.rawPayload,
            ) as any,
            totalAmount,
            discount,
            finalAmount,
            notes: orderNotes || null,
            customerName: normalizedOrder.customerName,
            customerPhone: normalizedOrder.customerPhone,
            tenantId,
            branchId,
            orderItems: {
              create: validItems.map((item) => ({
                productId: item.productId!,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                subtotal: item.subtotal,
                modifierTotal: item.modifierTotal,
                notes: item.notes,
              })),
            },
          },
          include: {
            orderItems: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    price: true,
                    image: true,
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
          },
        });
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // Concurrent webhook delivery — DB uniqueness caught the race
        // we couldn't catch with findFirst + create. Idempotent outcome.
        this.logger.debug(
          `Duplicate order skipped (DB race): ${platform} ${externalOrderId}`,
        );
        return null;
      }
      throw err;
    }

    if (!createdOrder) {
      return null;
    }

    // 5. If autoAccept, also accept on the platform side. Config +
    // autoAccept were resolved once before the txn (iter-39) — same
    // snapshot drove both `requiresApproval` and this branch.
    if (autoAccept && config) {
      try {
        const freshConfig = await this.authService.ensureValidToken(config.id);
        if (freshConfig) {
          const adapter = this.adapterFactory.getAdapter(platform);
          await adapter.acceptOrder(freshConfig, externalOrderId);

          await this.logService.log({
            tenantId,
            platform,
            direction: PlatformLogDirection.OUTBOUND,
            action: PlatformLogAction.ORDER_ACCEPTED,
            orderId: createdOrder.id,
            externalId: externalOrderId,
            success: true,
          });
        }
      } catch (error: any) {
        this.logger.error(
          `Failed to auto-accept order ${externalOrderId} on ${platform}: ${error.message}`,
        );
        await this.logService.log({
          tenantId,
          platform,
          direction: PlatformLogDirection.OUTBOUND,
          action: PlatformLogAction.ORDER_ACCEPTED,
          orderId: createdOrder.id,
          externalId: externalOrderId,
          success: false,
          error: error.message,
          nextRetryAt: new Date(Date.now() + 30_000),
        });

        // Circuit-breaker parity with iter-38 (menu/status sync). A
        // platform whose acceptOrder endpoint is permanently broken
        // (wrong API version, dropped credentials) would otherwise
        // loop forever — every webhook bumps the retry queue but the
        // config never auto-disables at CIRCUIT_BREAKER_THRESHOLD.
        await this.configService
          .recordError(config.id, `accept_order: ${error.message}`)
          .catch((e) => this.logger.warn(`recordError failed: ${e.message}`));
      }
    }

    // 6. Emit via KDS WebSocket
    this.kdsGateway.emitNewOrder(tenantId, createdOrder.branchId, createdOrder);

    // 6b. Auto-print the kitchen ticket — ONLY for an auto-accepted order that
    // is NOT gated into approval. An order that drifted on totals or had
    // unmapped items lands in PENDING_APPROVAL (requiresApproval=true): the
    // kitchen must not start cooking off a paper ticket before a human has
    // reviewed/approved it, or we'd print (and cook) an order whose money/items
    // we don't trust. Printing on the approve path (PENDING_APPROVAL→PENDING)
    // is out of scope for this ingest method.
    //
    // Best-effort otherwise: a printer that is offline / unmapped /
    // mis-encoding must NEVER block order ingestion — the order is already
    // persisted and on the KDS screen. Mirrors the auto-accept error handling
    // above (wrap + log, no rethrow).
    if (!createdOrder.requiresApproval) {
      await this.printKitchenTicket(
        tenantId,
        createdOrder.branchId,
        createdOrder,
      ).catch((err: any) =>
        this.logger.error(
          `Kitchen-ticket auto-print failed for ${platform} order ${createdOrder.orderNumber}: ${err?.message}`,
        ),
      );
    }

    // 7. Log the inbound order
    await this.logService.log({
      tenantId,
      platform,
      direction: PlatformLogDirection.INBOUND,
      action: PlatformLogAction.ORDER_RECEIVED,
      orderId: createdOrder.id,
      externalId: externalOrderId,
      success: true,
    });

    this.logger.log(
      `Order created from ${platform}: ${createdOrder.orderNumber} (${externalOrderId})`,
    );

    return createdOrder;
  }

  /**
   * Shared item-mapping + totals/drift logic used by BOTH processIncomingOrder
   * and applyPlatformAmendment so the two paths can NEVER diverge on the
   * money-sensitive bits (item→product mapping, modifier subtotals, the
   * platform-totals drift guard, the unmapped-items note). Runs inside the
   * caller's transaction (`tx`) so the mapping read is consistent with the
   * order write.
   */
  private async resolveItemsAndTotals(
    tx: Prisma.TransactionClient,
    tenantId: string,
    platform: string,
    normalizedOrder: NormalizedOrder,
  ): Promise<{
    validItems: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      subtotal: number;
      modifierTotal: number;
      notes?: string;
    }>;
    unmappedItems: NormalizedOrder["items"];
    totalsMismatch: boolean;
    orderNotes: string;
  }> {
    const { externalOrderId } = normalizedOrder;

    // Map platform items to internal products via MenuItemMapping.
    const itemMappings = await tx.menuItemMapping.findMany({
      where: {
        tenantId,
        platform,
        externalItemId: {
          in: normalizedOrder.items.map((i) => i.externalItemId),
        },
        isActive: true,
      },
      include: { product: true },
    });

    const mappingByExternalId = new Map(
      itemMappings.map((m) => [m.externalItemId, m]),
    );

    // Build order items - map to internal products when possible.
    const orderItems = normalizedOrder.items.map((item) => {
      const mapping = mappingByExternalId.get(item.externalItemId);
      const modifierTotal = (item.modifiers || []).reduce(
        (sum, m) => sum + m.price * m.quantity,
        0,
      );
      return {
        productId: mapping?.productId ?? null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.quantity * item.unitPrice + modifierTotal,
        modifierTotal,
        notes: item.notes
          ? `${item.name}${mapping ? "" : " (unmapped)"}: ${item.notes}`
          : !mapping
            ? `${item.name} (unmapped)`
            : undefined,
      };
    });

    // We need valid product mappings for order items.
    const validItems = orderItems.filter(
      (item): item is typeof item & { productId: string } =>
        item.productId !== null,
    );

    const unmappedCount = normalizedOrder.items.length - validItems.length;
    if (validItems.length === 0) {
      this.logger.warn(
        `No mapped items (${unmappedCount} unmapped) for ${platform} order ${externalOrderId} in tenant ${tenantId}. ` +
          `Storing order with notes.`,
      );
    }

    // Sanity-check the platform-supplied totals against the sum of items.
    // The platform sends finalAmount straight from its own ledger, so a
    // platform-side bug or compromise could silently overcharge customers.
    // Drift > 5% (or > 1₺ absolute on small orders) gates the order into
    // approval-required so a human reviews before fulfilling.
    //
    // The itemsSum MUST include paid-modifier charges (extra cheese, large
    // size, add-ons), because claimedSubtotal = totalAmount - discount and the
    // platform's totalAmount already bakes those modifier charges in. Summing
    // only unitPrice*qty under-counted every order with paid add-ons, so the
    // drift always equalled the modifier total → false-positive drift → orders
    // with add-ons were wrongly forced into PENDING_APPROVAL.
    const itemsSum = normalizedOrder.items.reduce((sum, it) => {
      const lineModifiers = (it.modifiers || []).reduce(
        (s, m) => s + Number(m.price) * Number(m.quantity),
        0,
      );
      return sum + Number(it.unitPrice) * Number(it.quantity) + lineModifiers;
    }, 0);
    const claimedSubtotal =
      Number(normalizedOrder.totalAmount) -
      Number(normalizedOrder.discount ?? 0);
    const drift = Math.abs(itemsSum - claimedSubtotal);
    const tolerance = Math.max(1.0, claimedSubtotal * 0.05);
    const totalsMismatch = drift > tolerance;
    if (totalsMismatch) {
      this.logger.warn(
        `Totals mismatch for ${platform} order ${externalOrderId}: items Σ=${itemsSum.toFixed(2)} vs claimed subtotal ${claimedSubtotal.toFixed(2)} (drift ${drift.toFixed(2)} > tolerance ${tolerance.toFixed(2)}). Forcing approval.`,
      );
    }

    // Build notes with platform info and unmapped items.
    const unmappedItems = normalizedOrder.items.filter(
      (item) => !mappingByExternalId.has(item.externalItemId),
    );
    const orderNotes = [
      normalizedOrder.notes,
      normalizedOrder.customerAddress
        ? `Adres: ${normalizedOrder.customerAddress}`
        : null,
      unmappedItems.length > 0
        ? `[UNMAPPED - needs menu mapping]\n${unmappedItems.map((i) => `  - ${i.name} x${i.quantity} @ ${i.unitPrice.toFixed(2)}`).join("\n")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    return { validItems, unmappedItems, totalsMismatch, orderNotes };
  }

  /**
   * Enqueue a kitchen-ticket ESC/POS print for a freshly-created delivery
   * order to the branch's kitchen printer(s). This is the SAME mechanism POS
   * orders use: build the canonical kitchen-ticket snapshot
   * (ReceiptSnapshotBuilder) → render ESC/POS bytes (EscPosBuilderService) →
   * wrap as a `print_receipt` device-mesh command → CommandQueueService.enqueue
   * targeting the `kitchen_printer` device(s) in the order's branch.
   *
   * Strictly best-effort. Any failure (no mapped printer, builder error, queue
   * write error) is logged and swallowed — the order is already persisted and
   * visible on the KDS, and a missing paper ticket must never bounce a webhook
   * (which would make the platform retry / mark us unavailable).
   */
  private async printKitchenTicket(
    tenantId: string,
    branchId: string,
    order: any,
  ): Promise<void> {
    // Find the kitchen printer(s) for this branch. A small footprint (1-2 per
    // kitchen); cap defensively like the KDS routing fan-out does. `retired`
    // devices are excluded — they can't print. `offline` devices are kept so
    // the command queues and prints when the bridge reconnects (the TTL
    // sweeper cleans up anything still stuck).
    const printers = await this.prisma.device.findMany({
      where: {
        tenantId,
        branchId,
        kind: "kitchen_printer",
        status: { in: ["online", "offline", "paired", "busy"] },
      },
      select: { id: true, config: true },
      take: 20,
    });

    if (printers.length === 0) {
      this.logger.debug(
        `No kitchen_printer device in branch ${branchId} for order ${order.orderNumber} — skipping auto-print`,
      );
      return;
    }

    // Build the canonical kitchen-ticket snapshot from the created order graph.
    // toBuilderOrder tolerates missing modifiers/table (delivery orders have no
    // table); the include in processIncomingOrder already pulls orderItems.product.
    const snapshot = this.snapshotBuilder.buildKitchenTicketSnapshot({
      order: ReceiptSnapshotBuilder.toBuilderOrder(order),
    });

    for (const printer of printers) {
      try {
        // Per-printer paper width from the device's free-form provisioning
        // config (e.g. { paperWidth: "58mm" }); default 80mm.
        const paperWidth =
          (printer.config as { paperWidth?: "58mm" | "80mm" } | null)
            ?.paperWidth === "58mm"
            ? "58mm"
            : "80mm";
        const job = this.escpos.buildKitchenTicket(snapshot, { paperWidth });
        const command = this.escpos.toPrintCommand(job);

        await this.commandQueue.enqueue(tenantId, printer.id, {
          kind: command.kind,
          payload: command.payload as unknown as Record<string, unknown>,
          // Kitchen tickets are high-priority — the food can't be made until
          // the line sees it. Matches POS receipt urgency.
          priority: 7,
          // Idempotent on (order, printer): a duplicate webhook that somehow
          // reaches this path again collapses onto the same command row rather
          // than printing two identical tickets.
          idempotencyKey: `delivery-kitchen:${order.id}:${printer.id}`,
        });
      } catch (err: any) {
        // Per-printer guard so one bad device doesn't starve the others.
        this.logger.error(
          `Failed to enqueue kitchen ticket for order ${order.orderNumber} to printer ${printer.id}: ${err?.message}`,
        );
      }
    }
  }

  /**
   * Apply a platform-driven status update (e.g. courier picked up the
   * order, customer cancelled). Until 2026-05-11 the Yemeksepeti webhook
   * handler logged these and returned 200 without writing — delivered
   * orders sat in KDS as READY forever. The mapping here is intentionally
   * narrow: PICKED_UP / DELIVERED → SERVED (kitchen has handed off);
   * CANCELLED / REJECTED → CANCELLED (kitchen stop). Anything else logs
   * and ignores (a no-op is safer than guessing).
   */
  async applyPlatformStatusUpdate(args: {
    platform: string;
    remoteOrderId: string;
    tenantId: string;
    platformStatus: string | undefined | null;
  }): Promise<{ matched: boolean; mappedTo?: OrderStatus }> {
    const { platform, remoteOrderId, tenantId, platformStatus } = args;
    if (!platformStatus) {
      this.logger.warn(
        `Platform status update without status field: ${platform} ${remoteOrderId}`,
      );
      return { matched: false };
    }

    const normalized = String(platformStatus)
      .toLowerCase()
      .replace(/[\s_-]/g, "");
    let target: OrderStatus | null = null;
    if (
      ["pickedup", "delivered", "completed", "finished"].includes(normalized)
    ) {
      target = OrderStatus.SERVED;
    } else if (
      ["cancelled", "canceled", "rejected", "failed"].includes(normalized)
    ) {
      target = OrderStatus.CANCELLED;
    }

    if (!target) {
      this.logger.debug(
        `Ignoring unmapped ${platform} status '${platformStatus}' for order ${remoteOrderId}`,
      );
      return { matched: false };
    }

    // Atomic claim. Filter on (tenantId, source, externalOrderId) plus a
    // status NOT IN [target, terminal-others] so a duplicate webhook
    // delivery doesn't bounce a CANCELLED order back to SERVED.
    const result = await this.prisma.order.updateMany({
      where: {
        tenantId,
        source: platform,
        externalOrderId: remoteOrderId,
        status: { notIn: [target, OrderStatus.PAID, OrderStatus.CANCELLED] },
      },
      data: {
        status: target,
        ...(target === OrderStatus.CANCELLED
          ? { cancelledAt: new Date() }
          : {}),
      },
    });

    if (result.count === 0) {
      this.logger.debug(
        `Status update no-op for ${platform} ${remoteOrderId}: order already in terminal state or not found`,
      );
      return { matched: false, mappedTo: target };
    }

    // Notify KDS so the kitchen view reflects the transition immediately.
    const order = await this.prisma.order.findFirst({
      where: { tenantId, source: platform, externalOrderId: remoteOrderId },
    });
    if (order) {
      this.kdsGateway.emitNewOrder(tenantId, order.branchId, order);
    }

    await this.logService.log({
      tenantId,
      platform: platform as any,
      direction: PlatformLogDirection.INBOUND,
      // Use the precise ORDER_CANCELLED action for a platform-originated
      // cancellation (better observability than a generic STATUS_UPDATE);
      // everything else stays STATUS_UPDATE.
      action:
        target === OrderStatus.CANCELLED
          ? PlatformLogAction.ORDER_CANCELLED
          : PlatformLogAction.STATUS_UPDATE,
      orderId: order?.id,
      externalId: remoteOrderId,
      request: { platformStatus, mappedTo: target },
      success: true,
    });

    return { matched: true, mappedTo: target };
  }

  /**
   * Apply an INBOUND platform refund to the internal Order honestly.
   *
   * Delivery orders are platform-owned money: the platform collected payment
   * from the customer and is the party that initiates a refund — so we NEVER
   * push anything back to the platform here (it told us). We only reflect the
   * refund on our side.
   *
   * Schema reality (see schema.prisma): the Order model has NO dedicated
   * refund column (no refundedAmount / refundedAt), and delivery orders never
   * create Payment rows (grep-confirmed — the platform owns the money rail),
   * so there is no Payment to flip to REFUNDED either. Given that, we record
   * the refund where the schema DOES support it:
   *   - FULL refund  → move the order to CANCELLED (cancelled-with-refund),
   *     set cancelledAt, append a refund note, append to externalData.refunds[].
   *   - PARTIAL refund → keep the status (kitchen may still be fulfilling),
   *     append a refund note + the refunded amount to externalData.refunds[].
   *     LIMITATION: with no refundedAmount column the partial amount lives only
   *     in notes + the externalData ledger + the delivery log + the emitted
   *     delivery.order.refunded.v1 event. Reporting/accounting must read those.
   *
   * Idempotent: a re-delivered refund webhook (same refundId, or same
   * full|amount shape) is recorded once — the append checks the existing
   * externalData.refunds[] for the refundKey and no-ops on a repeat.
   */
  async applyPlatformRefund(args: {
    platform: string;
    remoteOrderId: string;
    tenantId: string;
    /** Refunded amount in major units. Omitted/null/>=finalAmount ⇒ full refund. */
    refundAmount?: number | null;
    reason?: string | null;
    /** Platform's refund id — the strongest idempotency key when present. */
    refundId?: string | null;
  }): Promise<{
    matched: boolean;
    applied: boolean;
    type?: "full" | "partial";
    duplicate?: boolean;
  }> {
    const { platform, remoteOrderId, tenantId, reason, refundId } = args;

    // Run the read-append-write inside a SERIALIZABLE transaction so two
    // concurrently-delivered refund webhooks can't both read the same
    // externalData.refunds[] snapshot, both pass the idempotency check, and
    // both append (double-counting the refund). Postgres' default READ
    // COMMITTED does not catch this read-then-write skew on a single JSON
    // column — Serializable serialises the pair (the loser gets a 40001 that
    // Prisma surfaces as P2034 and the caller/queue retries). Mirrors the
    // Serializable read-modify-write pattern used by customers/loyalty/stock.
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        const order = await tx.order.findFirst({
          where: { tenantId, source: platform, externalOrderId: remoteOrderId },
        });
        if (!order) {
          return { matched: false as const, applied: false as const };
        }

        const finalAmount = Number(order.finalAmount);
        const rawAmount =
          args.refundAmount == null ? null : Number(args.refundAmount);
        // A non-finite / negative amount is treated as "amount unknown" → full.
        const amount =
          rawAmount != null && Number.isFinite(rawAmount) && rawAmount > 0
            ? rawAmount
            : null;
        // Full when no usable amount, or it covers (≈) the whole order.
        const isFull = amount == null || amount >= finalAmount - 0.001;
        const type: "full" | "partial" = isFull ? "full" : "partial";

        // Dedup key. When the platform supplies a refundId we trust it as the
        // strongest idempotency key. Without one we fall back to a
        // shape-derived key (full, or partial:<amount>).
        // LIMITATION: two genuinely-distinct partial refunds of the SAME amount
        // and NO refundId collapse onto the same `partial:<amount>` key and the
        // second is treated as a duplicate. We accept that over the opposite
        // failure (double-counting a re-delivered webhook), since platforms
        // that issue multiple equal partials in practice always carry a
        // refundId. There is no safer deterministic key absent a platform id.
        const refundKey = refundId
          ? `id:${refundId}`
          : isFull
            ? "full"
            : `partial:${amount!.toFixed(2)}`;

        // Read the append-only refund ledger off externalData (may be absent).
        const externalData =
          order.externalData && typeof order.externalData === "object"
            ? (order.externalData as Record<string, any>)
            : {};
        const existing: RecordedRefund[] = Array.isArray(externalData.refunds)
          ? (externalData.refunds as RecordedRefund[])
          : [];

        // Idempotency: same refundKey already recorded ⇒ no-op.
        if (existing.some((r) => r.refundKey === refundKey)) {
          this.logger.debug(
            `Refund no-op (duplicate ${refundKey}) for ${platform} ${remoteOrderId}`,
          );
          return {
            matched: true as const,
            applied: false as const,
            type,
            duplicate: true as const,
            orderId: order.id,
            branchId: order.branchId,
          };
        }

        // Guard: accumulated partial refunds must not exceed finalAmount. Sum
        // the already-recorded (numeric) partial amounts and clamp this one so
        // the ledger can never claim more was refunded than the order was
        // worth — a platform bug or duplicate-with-new-id could otherwise
        // over-credit. A full refund is recorded as-is (it caps at the whole
        // order by definition).
        let recordedAmount = amount;
        if (!isFull && amount != null) {
          const priorPartialSum = existing.reduce(
            (s, r) =>
              r.type === "partial" && typeof r.amount === "number"
                ? s + r.amount
                : s,
            0,
          );
          const remaining = finalAmount - priorPartialSum;
          if (amount > remaining + 0.001) {
            this.logger.warn(
              `Partial refund ${amount.toFixed(2)} for ${platform} ${remoteOrderId} ` +
                `exceeds remaining refundable ${Math.max(0, remaining).toFixed(2)} ` +
                `(finalAmount ${finalAmount.toFixed(2)}, prior partials ${priorPartialSum.toFixed(2)}). Clamping.`,
            );
            recordedAmount = Math.max(0, remaining);
          }
        }

        const recorded: RecordedRefund = {
          refundKey,
          type,
          amount: recordedAmount,
          reason: reason ?? undefined,
          at: new Date().toISOString(),
        };
        const refunds = [...existing, recorded];

        const noteLine = isFull
          ? `[REFUND] Full refund from ${platform}${reason ? ` — ${reason}` : ""}`
          : `[REFUND] Partial refund ${recordedAmount!.toFixed(2)} from ${platform}${reason ? ` — ${reason}` : ""}`;
        const notes = order.notes ? `${order.notes}\n${noteLine}` : noteLine;

        // A full refund moves the order to a cancelled-with-refund terminal
        // state UNLESS it's already terminal (PAID/CANCELLED) — never bounce a
        // settled order back. Partial keeps the current status.
        const goCancel =
          isFull &&
          order.status !== OrderStatus.CANCELLED &&
          order.status !== OrderStatus.PAID;

        await tx.order.update({
          where: { id: order.id },
          data: {
            notes,
            externalData: { ...externalData, refunds } as any,
            ...(goCancel
              ? { status: OrderStatus.CANCELLED, cancelledAt: new Date() }
              : {}),
          },
        });

        return {
          matched: true as const,
          applied: true as const,
          type,
          amount: recordedAmount,
          reason: reason ?? undefined,
          refundKey,
          statusChangedToCancelled: goCancel,
          orderId: order.id,
          branchId: order.branchId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!outcome.matched) {
      this.logger.debug(
        `Refund: no matching ${platform} order ${remoteOrderId} for tenant ${tenantId}`,
      );
      return { matched: false, applied: false };
    }

    // Re-emit to KDS so a cancelled-with-refund disappears from the line.
    const refreshed = await this.prisma.order.findUnique({
      where: { id: (outcome as any).orderId },
    });
    if (refreshed) {
      this.kdsGateway.emitNewOrder(tenantId, refreshed.branchId, refreshed);
    }

    // Fiscal reversal: a NEWLY-applied full refund that moved the order to
    // CANCELLED must reverse any ISSUED fatura with an İade faturası (credit
    // note), exactly like the POS refund rail (payments.service). Best-effort
    // + idempotent — an un-invoiced order or missing accounting config no-ops,
    // and a failure never breaks the already-committed refund write. Without
    // this, a platform-initiated refund left the sales invoice standing with
    // no reversing record (GİB compliance gap the POS rail already closed).
    if (
      outcome.applied &&
      (outcome as any).statusChangedToCancelled &&
      this.salesInvoiceService
    ) {
      try {
        await this.salesInvoiceService.createRefundCreditNote(
          (outcome as any).orderId,
          tenantId,
        );
      } catch (err: any) {
        this.logger.error(
          `Credit-note (İade faturası) generation failed for platform-refunded order ${(outcome as any).orderId}: ${err.message}`,
        );
      }
    }

    await this.logService.log({
      tenantId,
      platform,
      direction: PlatformLogDirection.INBOUND,
      action: PlatformLogAction.ORDER_REFUNDED,
      orderId: (outcome as any).orderId,
      externalId: remoteOrderId,
      request: {
        type: outcome.type,
        amount: (outcome as any).amount ?? null,
        reason: reason ?? null,
        duplicate: !outcome.applied,
        statusChangedToCancelled:
          (outcome as any).statusChangedToCancelled ?? false,
      },
      success: true,
    });

    // Emit the durable domain event only for a NEWLY-applied refund (not a
    // duplicate) so accounting consumers don't double-count.
    if (outcome.applied) {
      await this.outbox
        ?.append({
          type: DELIVERY_ORDER_REFUNDED_EVENT,
          tenantId,
          payload: {
            tenantId,
            branchId: (outcome as any).branchId,
            orderId: (outcome as any).orderId,
            platform,
            externalOrderId: remoteOrderId,
            type: outcome.type,
            amount: (outcome as any).amount ?? null,
            reason: reason ?? null,
            statusChangedToCancelled:
              (outcome as any).statusChangedToCancelled ?? false,
          },
          // Deterministic dedup key so a re-delivered webhook that somehow
          // re-applies (shouldn't, idempotency above) still collapses on the
          // bus. Uses the same refundKey we deduped on.
          idempotencyKey: `delivery-refund:${tenantId}:${platform}:${remoteOrderId}:${(outcome as any).refundKey}`,
        })
        .catch(
          captureSwallowedEmit(this.logger, {
            module: "delivery-platforms",
            op: "order_refunded",
          }),
        );
    }

    return {
      matched: true,
      applied: outcome.applied,
      type: outcome.type,
      duplicate: !outcome.applied,
    };
  }

  /**
   * Restaurant-INITIATED (outbound) refund. NONE of the four Turkish platform
   * adapters documents a restaurant-initiated refund endpoint — on Getir /
   * Yemeksepeti / Trendyol / Migros, refunds are owned by the platform's
   * customer-service / settlement flow, not the restaurant POS. So
   * PlatformAdapter.refundOrder is OPTIONAL and unimplemented by all four
   * adapters today. This method dispatches to it ONLY when an adapter actually
   * implements it; otherwise it throws an honest "unsupported" error rather
   * than faking a successful outbound call. To reflect an inbound,
   * platform-initiated refund use applyPlatformRefund instead.
   */
  async refundOrderOnPlatform(
    tenantId: string,
    platform: string,
    externalOrderId: string,
    amount?: number,
  ): Promise<void> {
    const config = await this.prisma.deliveryPlatformConfig.findUnique({
      where: { tenantId_platform: { tenantId, platform: platform as any } },
    });
    if (!config) {
      throw new Error(
        `No ${platform} config for tenant ${tenantId} — cannot initiate refund`,
      );
    }
    const adapter = this.adapterFactory.getAdapter(platform);
    if (typeof adapter.refundOrder !== "function") {
      // Honest, explicit: do NOT pretend the refund happened.
      throw new Error(
        `${platform} adapter does not support a restaurant-initiated refund (inbound-only). ` +
          `Issue the refund from the platform's own panel; we reflect it via the inbound refund webhook.`,
      );
    }
    const freshConfig =
      (await this.authService.ensureValidToken(config.id)) ?? config;
    await adapter.refundOrder(freshConfig as any, externalOrderId, amount);

    await this.logService.log({
      tenantId,
      platform,
      direction: PlatformLogDirection.OUTBOUND,
      action: PlatformLogAction.ORDER_REFUNDED,
      externalId: externalOrderId,
      request: { amount: amount ?? null },
      success: true,
    });
  }

  /**
   * Apply an INBOUND order AMENDMENT — the platform changed an existing
   * order's items (added/removed/qty changed) BEFORE the kitchen committed it.
   *
   * Re-resolves items via MenuItemMapping and recomputes totals using the
   * SAME drift-safe logic as processIncomingOrder (shared resolveItemsAndTotals
   * helper), replaces the existing order's items + amounts in one transaction,
   * and re-emits to KDS so the line sees the change.
   *
   * Guards:
   *   - Refuse if the order is in a committed/served/terminal state
   *     (READY/SERVED/PAID/CANCELLED) — mutating items after the food is out
   *     would desync the ticket from what was cooked. The platform must cancel
   *     + re-order instead. Returns { matched: true, refused: true }.
   *   - Idempotent: a stable hash of the amended cart is stored on
   *     externalData.amendmentHash; a re-delivered identical amendment no-ops.
   */
  async applyPlatformAmendment(
    tenantId: string,
    normalizedOrder: NormalizedOrder,
  ): Promise<{
    matched: boolean;
    applied: boolean;
    refused?: boolean;
    reason?: string;
    duplicate?: boolean;
  }> {
    const { platform, externalOrderId } = normalizedOrder;

    // Stable hash of the incoming cart for idempotency — order-independent so
    // re-delivery with reordered items still dedups.
    const amendmentHash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify(
          [...normalizedOrder.items]
            .map((i) => ({
              e: i.externalItemId,
              q: i.quantity,
              p: i.unitPrice,
              m: (i.modifiers || [])
                .map((x) => `${x.name}:${x.price}:${x.quantity}`)
                .sort(),
            }))
            .sort((a, b) => (a.e > b.e ? 1 : -1)),
        ) +
          `|${normalizedOrder.totalAmount}|${normalizedOrder.discount}|${normalizedOrder.finalAmount}`,
      )
      .digest("hex");

    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { tenantId, source: platform, externalOrderId },
      });
      if (!order) {
        return { matched: false as const, applied: false as const };
      }

      // Guard: don't amend a committed/served/terminal order.
      if (AMENDMENT_LOCKED_STATUSES.includes(order.status as OrderStatus)) {
        return {
          matched: true as const,
          applied: false as const,
          refused: true as const,
          reason: `order is ${order.status} — too late to amend`,
          orderId: order.id,
          branchId: order.branchId,
        };
      }

      // Idempotency: identical amendment already applied ⇒ no-op.
      const externalData =
        order.externalData && typeof order.externalData === "object"
          ? (order.externalData as Record<string, any>)
          : {};
      if (externalData.amendmentHash === amendmentHash) {
        return {
          matched: true as const,
          applied: false as const,
          duplicate: true as const,
          orderId: order.id,
          branchId: order.branchId,
        };
      }

      // Re-resolve items + totals with the shared, drift-safe logic.
      const resolved = await this.resolveItemsAndTotals(
        tx,
        tenantId,
        platform,
        normalizedOrder,
      );

      // Replace the line items wholesale (delete + recreate) — the platform
      // sends the full amended cart, not a delta.
      await tx.orderItem.deleteMany({ where: { orderId: order.id } });

      // An amendment that drifts or fully unmaps gates back to approval, same
      // rationale as ingestion.
      const requiresApproval =
        resolved.unmappedItems.length > 0 || resolved.totalsMismatch;

      await tx.order.update({
        where: { id: order.id },
        data: {
          totalAmount: normalizedOrder.totalAmount,
          discount: normalizedOrder.discount,
          finalAmount: normalizedOrder.finalAmount,
          notes: resolved.orderNotes || null,
          requiresApproval,
          ...(requiresApproval ? { status: OrderStatus.PENDING_APPROVAL } : {}),
          externalData: {
            ...externalData,
            amendmentHash,
            amendedAt: new Date().toISOString(),
          } as any,
          orderItems: {
            create: resolved.validItems.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: item.subtotal,
              modifierTotal: item.modifierTotal,
              notes: item.notes,
            })),
          },
        },
      });

      return {
        matched: true as const,
        applied: true as const,
        orderId: order.id,
        branchId: order.branchId,
      };
    });

    if (!result.matched) {
      this.logger.debug(
        `Amendment: no matching ${platform} order ${externalOrderId} for tenant ${tenantId}`,
      );
      return { matched: false, applied: false };
    }

    if ((result as any).refused) {
      this.logger.warn(
        `Amendment refused for ${platform} ${externalOrderId}: ${(result as any).reason}`,
      );
      await this.logService.log({
        tenantId,
        platform,
        direction: PlatformLogDirection.INBOUND,
        action: PlatformLogAction.ORDER_AMENDED,
        orderId: (result as any).orderId,
        externalId: externalOrderId,
        request: { refused: true, reason: (result as any).reason },
        success: false,
      });
      return {
        matched: true,
        applied: false,
        refused: true,
        reason: (result as any).reason,
      };
    }

    // Re-emit the (possibly unchanged on duplicate) order to KDS so the
    // kitchen view reflects the amended items immediately.
    const refreshed = await this.prisma.order.findUnique({
      where: { id: (result as any).orderId },
      include: {
        orderItems: {
          include: {
            product: {
              select: { id: true, name: true, price: true, image: true },
            },
          },
        },
        table: { select: { id: true, number: true, section: true } },
      },
    });
    if (refreshed && result.applied) {
      this.kdsGateway.emitNewOrder(tenantId, refreshed.branchId, refreshed);
    }

    await this.logService.log({
      tenantId,
      platform,
      direction: PlatformLogDirection.INBOUND,
      action: PlatformLogAction.ORDER_AMENDED,
      orderId: (result as any).orderId,
      externalId: externalOrderId,
      request: { duplicate: !result.applied, amendmentHash },
      success: true,
    });

    if (result.applied) {
      await this.outbox
        ?.append({
          type: DELIVERY_ORDER_AMENDED_EVENT,
          tenantId,
          payload: {
            tenantId,
            branchId: (result as any).branchId,
            orderId: (result as any).orderId,
            platform,
            externalOrderId,
            totalAmount: normalizedOrder.totalAmount,
            finalAmount: normalizedOrder.finalAmount,
          },
          idempotencyKey: `delivery-amend:${tenantId}:${platform}:${externalOrderId}:${amendmentHash}`,
        })
        .catch(
          captureSwallowedEmit(this.logger, {
            module: "delivery-platforms",
            op: "order_amended",
          }),
        );
    }

    this.logger.log(
      `Amendment ${result.applied ? "applied" : "no-op (duplicate)"} for ${platform} order ${externalOrderId}`,
    );

    return {
      matched: true,
      applied: result.applied,
      duplicate: !result.applied,
    };
  }
}
