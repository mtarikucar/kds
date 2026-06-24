import {
  Injectable,
  NotFoundException,
  ConflictException,
  Optional,
  Logger,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  PaymentStatus,
  OrderStatus,
} from "../../../common/constants/order-status.enum";
import { TableStatus } from "../../tables/dto/create-table.dto";
import { LoyaltyService } from "../../customers/loyalty.service";
import * as Sentry from "@sentry/node";
import { SalesInvoiceService } from "../../accounting/services/sales-invoice.service";
import { AccountingSettingsService } from "../../accounting/services/accounting-settings.service";
import { ReceiptSnapshotBuilder } from "./receipt-snapshot.builder";
import { KdsGateway } from "../../kds/kds.gateway";
import { FiscalService } from "../../fiscal-core/fiscal.service";
import { TableAnalyticsProducerService } from "../../analytics/services/table-analytics-producer.service";

/**
 * PASS 2 of the payments.service refactor. The finalization cluster —
 * the in-transaction side-effects (lock, self-pay guard, PAID transition,
 * per-payment linkage, receipt snapshot) plus the post-commit side-effects
 * (loyalty crediting, auto-invoice, socket emit) — moved here VERBATIM
 * from PaymentsService.
 *
 * CRITICAL contract preserved from the original: every method that mutates
 * inside a transaction takes the active `tx` (Prisma.TransactionClient) as
 * its FIRST parameter and runs no $transaction of its own. PaymentsService
 * still owns and opens every $transaction boundary and calls
 * `finalizer.X(tx, ...)`. The post-commit helpers (creditLoyaltyForFinalizedOrder,
 * maybeGenerateAutoInvoice, safeEmitPaymentSuccess) run AFTER the outer
 * $transaction resolves, exactly as before.
 */
@Injectable()
export class PaymentFinalizer {
  private readonly logger = new Logger(PaymentFinalizer.name);

  constructor(
    private prisma: PrismaService,
    private receiptSnapshotBuilder: ReceiptSnapshotBuilder,
    private loyaltyService: LoyaltyService,
    @Optional()
    private salesInvoiceService?: SalesInvoiceService,
    @Optional()
    private accountingSettingsService?: AccountingSettingsService,
    @Optional()
    @Inject(forwardRef(() => KdsGateway))
    private kdsGateway?: KdsGateway,
    // FiscalCoreModule is @Global, so this resolves in production. Kept
    // @Optional so the many unit specs that construct PaymentFinalizer bare
    // (and the partial-payment paths that never touch fiscalization) keep
    // working — a null fiscalService simply skips the yazarkasa leg.
    @Optional()
    private fiscalService?: FiscalService,
    // REAL producer for the paid Table-Analytics / Customer-Behavior tabs.
    // @Optional for the same reason as fiscalService: the bare-constructor
    // unit specs don't supply it, and a missing producer simply skips the
    // metrics write (the source of truth is the Order/Payment rows).
    @Optional()
    private tableAnalyticsProducer?: TableAnalyticsProducerService,
  ) {}

  /**
   * Post-commit, best-effort REAL analytics aggregation. Called on a
   * fully-paid transition (alongside loyalty/auto-invoice/yazarkasa) so the
   * paid "Table Analytics" + "Customer Behavior" tabs are populated from
   * genuine Order/Payment data — never the dev-only MockDataGenerator.
   * Swallows errors: a metrics failure must never affect the payment.
   */
  async recordTableAnalyticsForPaidOrder(
    orderId: string,
    tenantId: string,
  ): Promise<void> {
    if (!this.tableAnalyticsProducer) return;
    await this.tableAnalyticsProducer.recordTableAnalyticsForPaidOrder(
      orderId,
      tenantId,
    );
  }

  /**
   * Wrapper around KdsGateway.emitPaymentSuccess that swallows
   * errors — socket emit failures must NEVER fail a payment write.
   * The auto-print is a convenience; the source of truth is the
   * Payment row.
   *
   * `initiatedByUserId` echoes the JWT user that triggered the write
   * (waiter cash etc.); webhook / customer self-pay paths pass null.
   * Clients use it to suppress a duplicate auto-print on the
   * originating tablet (its createPayment.onSuccess already printed).
   */
  safeEmitPaymentSuccess(
    tenantId: string,
    payment: any,
    initiatedByUserId: string | null = null,
  ): void {
    if (!this.kdsGateway) return;
    try {
      this.kdsGateway.emitPaymentSuccess(
        tenantId,
        payment.branchId,
        {
          id: payment.id,
          orderId: payment.orderId,
          amount: payment.amount,
          method: payment.method,
          receiptSnapshot: payment.receiptSnapshot,
        },
        initiatedByUserId,
      );
    } catch (err) {
      this.logger.warn(
        `payment:success emit failed for ${payment?.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Acquire a row-level lock on an order. Serializes concurrent payment
   * paths (`create`, `splitBill`, `payByItems`) on the same order so the
   * "validate remaining → insert payment" sequence is atomic across
   * sessions. Without this, two waiters paying the last unit of an item
   * could both pass the remaining-qty check before either inserted.
   *
   * Must be called as the first DB operation inside a `$transaction`.
   */
  async acquireOrderLock(
    tx: Prisma.TransactionClient,
    orderId: string,
    tenantId: string,
  ): Promise<void> {
    // Restrict the lock to (id, tenantId) so a foreign tenantId can't
    // squat a row it doesn't own.
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM orders WHERE id = ${orderId} AND "tenantId" = ${tenantId} FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new NotFoundException("Order not found");
    }
  }

  /**
   * v3.0.1 round-5 audit fix — full-order pre-check that refuses a
   * waiter-side payment while a customer is mid-PayTR self-pay flow
   * on the SAME order. Pre-fix only `payByItems` consulted
   * PendingSelfPayment; `create()` and `splitBill()` happily booked
   * a Payment for the whole order while a customer's intent was live.
   * The customer's PayTR callback would then settle, throw
   * `settlement_error` in customer-self-pay.service when the order had
   * zero remaining, and the customer was charged with no booking
   * (Sentry → manual refund).
   *
   * Item-level reservation logic lives in `payByItems` because that
   * flow allows partial settlement; here we just refuse outright when
   * ANY non-expired PENDING intent references this order.
   */
  async assertNoConflictingSelfPayIntent(
    tx: Prisma.TransactionClient,
    orderId: string,
    tenantId: string,
  ): Promise<void> {
    const now = new Date();
    const pending = await tx.pendingSelfPayment.findFirst({
      where: { tenantId, status: "PENDING", expiresAt: { gt: now } },
      select: { itemsByOrder: true, expiresAt: true },
    });
    if (!pending) return;
    const buckets = pending.itemsByOrder as Array<{ orderId: string }>;
    if (!Array.isArray(buckets)) return;
    if (buckets.some((b) => b?.orderId === orderId)) {
      throw new ConflictException(
        "A customer is currently paying for this order via PayTR — wait for that intent to finalize (up to 15 minutes) before collecting at the POS.",
      );
    }
  }

  /**
   * Move an order to PAID and run the side effects that go with that
   * transition: link customer (if a phone was supplied), update the
   * order, release the table (when no other active orders remain), and
   * bump the customer's lifetime stats.
   *
   * Extracted from `create()` and shared with `splitBill()` and
   * `payByItems()`. Keeps the three payment paths in sync — drift
   * between them caused several bugs in the prior code.
   *
   * Caller contract: only invoke when the CURRENT payment closes the
   * order (i.e. sum(completed payments) ≥ order.finalAmount). The
   * `closingAmount` credited to the customer is the full order
   * finalAmount, never a partial slice — partial-payment paths must
   * NOT call this helper.
   */
  async finalizeFullyPaid(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      tableId: string | null;
      customerId: string | null;
      customerPhone?: string | null;
      finalAmount: Prisma.Decimal | number | string;
      tenantId: string;
    },
    customerPhone: string | undefined,
    closingAmount: Prisma.Decimal,
    opts: { bumpCustomerStats?: boolean } = { bumpCustomerStats: true },
  ): Promise<void> {
    // Resolve customer link (use existing customerId from order if already linked).
    let customerId: string | null = order.customerId;
    if (!customerId && customerPhone) {
      let customer = await tx.customer.findFirst({
        where: { phone: customerPhone, tenantId: order.tenantId },
      });
      if (!customer) {
        customer = await tx.customer.create({
          data: {
            phone: customerPhone,
            name: `Customer ${customerPhone}`,
            tenantId: order.tenantId,
          },
        });
      }
      customerId = customer.id;
    }

    // Never overwrite a customerPhone already stored on the order — a
    // wrong/typo phone on the closing payment would otherwise clobber
    // the linkage made at order creation time (or by the customer
    // self-order flow).
    const phoneToWrite =
      customerPhone && !order.customerPhone ? customerPhone : undefined;

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.PAID,
        paidAt: new Date(),
        ...(customerId && customerId !== order.customerId && { customerId }),
        ...(phoneToWrite && { customerPhone: phoneToWrite }),
      },
    });

    // Release the table when no other active orders remain on it.
    // v2.8.93 — table update uses updateMany with (id, tenantId) compound
    // WHERE so a wrong/spoofed tableId can never mark another tenant's
    // table AVAILABLE. The pre-fix used update() with id-only which would
    // happily mutate any tenant's row that matched on id.
    if (order.tableId) {
      const otherActiveOrders = await tx.order.count({
        where: {
          tableId: order.tableId,
          id: { not: order.id },
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        },
      });
      if (otherActiveOrders === 0) {
        await tx.table.updateMany({
          where: { id: order.tableId, tenantId: order.tenantId },
          data: { status: TableStatus.AVAILABLE },
        });
      }
    }

    // Bump customer lifetime stats. Opt-out exists because the prior
    // splitBill behaviour did NOT touch customer.totalSpent (the
    // DTO had a customerPhone field but the service never used it).
    // Keeping the helper opt-in for that path avoids silently
    // inflating CRM totals on the first deploy after the refactor.
    if (opts.bumpCustomerStats !== false && customerId) {
      // v2.8.93 — findFirst with tenantId scope replaces findUnique({id}).
      // Same risk class as the table update above: a customerId pointing
      // at another tenant's customer would otherwise let payment
      // finalization mutate totalOrders/totalSpent on the foreign row.
      const customer = await tx.customer.findFirst({
        where: { id: customerId, tenantId: order.tenantId },
      });
      if (customer) {
        const newTotalOrders = customer.totalOrders + 1;
        const newTotalSpent = new Prisma.Decimal(customer.totalSpent).add(
          closingAmount,
        );
        const newAverageOrder = newTotalSpent.div(newTotalOrders);
        // updateMany propagates the tenantId filter through the write.
        // Belt-and-suspenders with the findFirst above.
        await tx.customer.updateMany({
          where: { id: customerId, tenantId: order.tenantId },
          data: {
            totalOrders: newTotalOrders,
            totalSpent: newTotalSpent,
            averageOrder: newAverageOrder,
            lastVisit: new Date(),
          },
        });
      }
    }
  }

  /**
   * Post-commit loyalty crediting. Called by every payment-create
   * orchestrator AFTER its outer `$transaction` resolves — running
   * inside the tx would push the interactive-transaction budget over
   * the 5s ceiling (loyalty does its own read-update-write). Idempotent
   * on (customer, order); retries are safe.
   */
  async creditLoyaltyForFinalizedOrder(
    orderId: string,
    tenantId: string,
  ): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          customerId: true,
          finalAmount: true,
          status: true,
          orderNumber: true,
        },
      });
      if (!order?.customerId || order.status !== "PAID") return;
      // v2.8.96 — pass the Decimal through directly. Pre-fix the
      // Number(finalAmount.toString()) bounce risked precision loss
      // (Number_MAX_SAFE for huge aggregates, IEEE-754 drift for
      // future fractional pointsPerCurrencyUnit). loyalty service
      // now accepts number | string | Decimal and routes through
      // Prisma.Decimal arithmetic internally.
      await this.loyaltyService.earnPointsFromOrder(
        order.customerId,
        tenantId,
        orderId,
        order.orderNumber ?? "",
        order.finalAmount as any,
      );
    } catch (err: any) {
      this.logger.warn(
        `loyalty.earnPointsFromOrder post-commit failed for order=${orderId}: ${err?.message ?? err}`,
      );
    }
  }

  /**
   * Build the immutable receipt snapshot for a payment row. Shared by
   * every payment-creation path (create, splitBill, payByItems,
   * writeOff) so each one persists the same reprint-safe artifact —
   * customer self-pay via PayTR, waiter cash, manager write-off all
   * get a snapshot. Without this, only the legacy single-payment
   * path wrote a snapshot, and customer self-pay receipts were null.
   *
   * Snapshot generation is wrapped in a try/catch and degrades to
   * Prisma.JsonNull on failure — the convenience reprint feature
   * must NOT block a payment from being recorded.
   */
  async buildReceiptSnapshotForPayment(
    tx: Prisma.TransactionClient,
    orderId: string,
    tenantId: string,
    paymentInputs: { method: string; transactionId: string | null },
  ): Promise<Prisma.InputJsonValue | typeof Prisma.JsonNull> {
    const graph = await this.fetchSnapshotGraph(tx, orderId, tenantId);
    return this.buildReceiptSnapshotFromGraph(graph, orderId, paymentInputs);
  }

  /**
   * Fetch the loop-invariant snapshot inputs (tenant + full order graph) ONCE.
   * splitBill builds N per-entry snapshots that differ only in payment.method;
   * hoisting this out of the loop avoids 2N redundant deep order reads while the
   * order row is held under FOR UPDATE. Returns null on a tenant/order miss
   * (snapshot degrades to JsonNull, never blocking the payment write).
   *
   * The two queries here run in the same order as the old inline helper, so
   * existing payByItems mock-sequence specs are unaffected.
   */
  async fetchSnapshotGraph(
    tx: Prisma.TransactionClient,
    orderId: string,
    tenantId: string,
  ) {
    const tenantRow = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, currency: true },
    });
    if (!tenantRow) return null;
    const orderForSnap = await tx.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        orderItems: {
          include: {
            product: true,
            modifiers: { include: { modifier: true } },
          },
        },
        table: true,
      },
    });
    if (!orderForSnap) return null;
    return { tenantRow, orderForSnap };
  }

  /** Pure (no-DB) snapshot build from a pre-fetched graph; degrades to JsonNull. */
  buildReceiptSnapshotFromGraph(
    graph: Awaited<ReturnType<PaymentFinalizer["fetchSnapshotGraph"]>>,
    orderId: string,
    paymentInputs: { method: string; transactionId: string | null },
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (!graph) return Prisma.JsonNull;
    try {
      return this.receiptSnapshotBuilder.buildReceiptSnapshot({
        tenant: graph.tenantRow,
        order: ReceiptSnapshotBuilder.toBuilderOrder(graph.orderForSnap),
        payment: {
          method: paymentInputs.method,
          transactionId: paymentInputs.transactionId,
          paidAt: new Date(),
        },
      }) as unknown as Prisma.InputJsonValue;
    } catch (snapErr) {
      this.logger.warn(
        `Failed to build receipt snapshot for order ${orderId}: ${(snapErr as Error).message}`,
      );
      return Prisma.JsonNull;
    }
  }

  /**
   * Per-Payment customer linkage for the progressive flow. Each diner
   * can hand the waiter their own phone; their customer.totalSpent
   * gets bumped by ONLY this payment's amount, not the whole order.
   *
   * totalOrders semantics: incremented only the FIRST time this
   * customer appears on this order (so a single diner paying with
   * three swipes doesn't show up as +3 orders in their lifetime).
   */
  async linkCustomerForPayment(
    tx: Prisma.TransactionClient,
    payment: {
      id: string;
      orderId: string;
      tenantId: string;
      amount: Prisma.Decimal | number | string;
    },
    phone: string,
  ): Promise<void> {
    let customer = await tx.customer.findFirst({
      where: { phone, tenantId: payment.tenantId },
    });
    if (!customer) {
      customer = await tx.customer.create({
        data: {
          phone,
          name: `Customer ${phone}`,
          tenantId: payment.tenantId,
        },
      });
    }

    // Link the payment row to the customer for audit / per-customer
    // history reads. The Payment.customerId column was added in the
    // 20260513150000_payment_customer_link migration.
    await tx.payment.update({
      where: { id: payment.id },
      data: { customerId: customer.id },
    });

    // Has this customer already paid for this order? Count any prior
    // completed Payment on the same order with the same customerId.
    // If so we only bump totalSpent (no double-count of totalOrders).
    const priorOnThisOrder = await tx.payment.count({
      where: {
        orderId: payment.orderId,
        status: PaymentStatus.COMPLETED,
        customerId: customer.id,
        id: { not: payment.id },
      },
    });

    const amount = new Prisma.Decimal(payment.amount);
    const newTotalSpent = new Prisma.Decimal(customer.totalSpent).add(amount);
    const newTotalOrders =
      priorOnThisOrder === 0 ? customer.totalOrders + 1 : customer.totalOrders;
    const newAverage =
      newTotalOrders > 0
        ? newTotalSpent.div(newTotalOrders)
        : new Prisma.Decimal(0);

    await tx.customer.update({
      where: { id: customer.id },
      data: {
        totalSpent: newTotalSpent,
        totalOrders: newTotalOrders,
        averageOrder: newAverage,
        lastVisit: new Date(),
      },
    });
  }

  /**
   * Run the bounded-retry / Sentry-instrumented auto-invoice trigger.
   * Shared by all three payment paths so we don't end up with three
   * subtly different retry policies.
   *
   * If `paymentId` is supplied, generates a per-Payment fatura (Turkish
   * e-fatura compliance: each customer in a progressive flow gets
   * their own invoice with the correct payment method + KDV lines for
   * only what they bought). Otherwise generates an order-level
   * invoice (the legacy single-payment / split-bill flow).
   */
  async maybeGenerateAutoInvoice(
    orderId: string,
    tenantId: string,
    paymentId?: string,
  ): Promise<void> {
    if (!this.salesInvoiceService || !this.accountingSettingsService) return;
    try {
      const accSettings =
        await this.accountingSettingsService.findByTenant(tenantId);
      if (!accSettings.autoGenerateInvoice) return;
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (paymentId) {
            await this.salesInvoiceService.createFromPayment(
              paymentId,
              tenantId,
            );
          } else {
            await this.salesInvoiceService.createFromOrder(orderId, tenantId);
          }
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, attempt * 250));
          }
        }
      }
      if (lastErr) {
        const msg =
          lastErr instanceof Error ? lastErr.message : String(lastErr);
        const stack = lastErr instanceof Error ? lastErr.stack : undefined;
        this.logger.error(
          `REVENUE_SYNC_FAILED: auto-invoice for order ${orderId}: ${msg}`,
          stack,
        );
        Sentry.captureException(lastErr, {
          tags: { event: "REVENUE_SYNC_FAILED", tenantId },
          extra: { orderId },
        });
      }
    } catch (err: any) {
      this.logger.error(
        `Auto-invoice settings lookup failed for order ${orderId}: ${err.message}`,
        err.stack,
      );
      Sentry.captureException(err, {
        tags: { event: "REVENUE_SYNC_FAILED", tenantId },
        extra: { orderId, phase: "settings-lookup" },
      });
    }
  }

  /**
   * Post-commit physical-yazarkasa (ÖKC) fiscal-receipt issuance.
   *
   * Turkey has TWO mutually-exclusive fiscalization regimes for a sale:
   *   - e-Fatura / e-Arşiv (cloud e-document) → handled by
   *     maybeGenerateAutoInvoice → SalesInvoiceService → AccountingSync, and
   *   - a physical "new generation" yazarkasa (YN ÖKC, GMP-3 via Hugin/Beko/
   *     Profilo) that prints a paper fiscal receipt at the counter.
   *
   * A tenant uses ONE of them, never both — issuing both for the same sale is
   * a double-fiscalization (the turnover would be reported twice). So this
   * leg is STRICTLY GATED: it only fires when the tenant has a configured,
   * non-retired PHYSICAL yazarkasa FiscalDeviceRecord. The cloud `efatura`
   * provider is explicitly excluded here (that pseudo-device represents the
   * e-document path, which the accounting rail already owns) — gating on it
   * would double-issue against e-Fatura.
   *
   * HONESTY NOTE: actual receipt printing depends on a certified ÖKC unit +
   * the branch's local-bridge driver (a separate wave). Until a tenant
   * registers such a device, NO FiscalDeviceRecord matches and this method is
   * a no-op — the WIRING is real even while the feature is dormant. When a
   * device IS present, FiscalService.issueReceipt enqueues the GMP-3 command
   * onto the device-mesh queue (status 'queued' until the bridge acks); it
   * never claims a fake issuance.
   *
   * Idempotent: the FiscalReceipt idempotencyKey is derived deterministically
   * from the orderId, and FiscalService.issueReceipt dedupes on
   * (tenantId, idempotencyKey) — a re-run for the same order returns the
   * existing receipt instead of double-printing.
   *
   * Best-effort: wrapped in try/catch so a fiscal-device outage NEVER blocks
   * or rolls back the payment (mirrors maybeGenerateAutoInvoice). Runs
   * post-commit, like loyalty/auto-invoice.
   */
  async maybeIssueYazarkasaReceipt(
    orderId: string,
    tenantId: string,
  ): Promise<void> {
    if (!this.fiscalService) return;
    try {
      // GATE: only a tenant with a real physical yazarkasa gets a paper
      // fiscal receipt. Exclude the cloud `efatura` pseudo-device (e-document
      // path owned by accounting) to avoid double-fiscalization, and skip
      // retired units. providerId in ('hugin','beko','profilo',…) = a GMP-3
      // ÖKC routed through the local bridge.
      const device = await this.prisma.fiscalDeviceRecord.findFirst({
        where: {
          tenantId,
          status: { not: "retired" },
          providerId: { not: "efatura" },
        },
        orderBy: { createdAt: "asc" },
      });
      if (!device) return; // dormant: no physical ÖKC configured for this tenant

      const order = await this.prisma.order.findFirst({
        where: { id: orderId, tenantId, status: "PAID" },
        include: {
          orderItems: { include: { product: true } },
          payments: true,
        },
      });
      if (!order || order.orderItems.length === 0) return;

      // Build GMP-3 fiscal lines from the paid order. Money in integer kuruş
      // (yazarkasa firmware is integer-only). productCode = productId; the
      // GMP-3 adapter buckets lines into KDV departments from device config,
      // not by a catalogue SKU lookup.
      //
      // RECONCILE: the order-level discount is apportioned across the lines by
      // value (largest-remainder, so the per-line discountCents sum equals
      // order.discount EXACTLY — no rounding drift on a legally-binding fiş),
      // and the tender comes from the real COMPLETED Payment rows (cash/card
      // split), not a lumped cash total. Both are required for a correct KDV
      // breakdown + tender on the fiş before a physical ÖKC is activated.
      const unitPricesCents = order.orderItems.map((it) =>
        Math.round(Number(it.unitPrice) * 100),
      );
      const lineValuesCents = order.orderItems.map((it, i) =>
        Math.round(it.quantity * unitPricesCents[i]),
      );
      const orderDiscountCents = Math.round(Number(order.discount) * 100);
      const perLineDiscount = this.apportionDiscount(
        lineValuesCents,
        orderDiscountCents,
      );

      const lines = order.orderItems.map((it, i) => ({
        productCode: it.productId,
        name: it.product?.name ?? "Ürün",
        qty: it.quantity,
        unitPriceCents: unitPricesCents[i],
        vatRate: it.taxRate ?? 10,
        discountCents: perLineDiscount[i],
      }));

      // Net the fiş must balance to (line totals after the apportioned discount).
      const netCents = lineValuesCents.reduce(
        (acc, v, i) => acc + v - perLineDiscount[i],
        0,
      );

      // Real per-method tender from the COMPLETED Payment rows.
      const completed = order.payments.filter((p) => p.status === "COMPLETED");
      let payments = completed.map((p) => ({
        method: this.toFiscalTender(p.method),
        amountCents: Math.round(Number(p.amount) * 100),
      }));
      const tenderedCents = payments.reduce((a, p) => a + p.amountCents, 0);

      // The tender lines MUST sum to the goods total on a fiş. Use the real
      // per-method split only when it reconciles to the net; otherwise (no
      // COMPLETED rows, tips/change, partial settlement) fall back to a single
      // balanced cash line and warn — never emit a mismatched legal receipt.
      if (payments.length === 0 || tenderedCents !== netCents) {
        if (payments.length > 0) {
          this.logger.warn(
            `Yazarkasa tender mismatch for order ${orderId}: ` +
              `payments=${tenderedCents}c net=${netCents}c — using net cash fallback`,
          );
        }
        payments = [{ method: "cash", amountCents: netCents }];
      }

      await this.fiscalService.issueReceipt({
        tenantId,
        // Order.branchId is NOT NULL; the receipt is issued at the order's branch.
        branchId: order.branchId,
        fiscalDeviceId: device.id,
        orderId,
        // Deterministic key → idempotent per order (FiscalService dedupes on
        // tenantId+idempotencyKey, so a retry/double-finalize won't double-print).
        idempotencyKey: `order-fiscal:${orderId}`,
        lines,
        payments,
        kind: "cash_receipt",
      });
    } catch (err: any) {
      // Never block the payment on a fiscal-device problem. The FiscalReceipt
      // row (queued/failed) and the ops manual-recovery panel are the durable
      // record; surface to logs/Sentry for alerting.
      this.logger.error(
        `Yazarkasa fiscal issuance failed for order ${orderId}: ${err?.message ?? err}`,
        err?.stack,
      );
      Sentry.captureException(err, {
        tags: { event: "FISCAL_RECEIPT_FAILED", tenantId },
        extra: { orderId },
      });
    }
  }

  /**
   * Apportion an order-level discount (kuruş) across line values using the
   * largest-remainder method. Guarantees `sum(result) === min(discount, total)`
   * exactly so the per-line discountCents never drift off the order discount on
   * a legally-binding fiş. Returns all-zero when there is no discount or no
   * value to split against.
   */
  private apportionDiscount(
    lineValuesCents: number[],
    discountCents: number,
  ): number[] {
    const total = lineValuesCents.reduce((a, b) => a + b, 0);
    if (discountCents <= 0 || total <= 0) {
      return lineValuesCents.map(() => 0);
    }
    // Never apportion more than the goods are worth.
    const toSplit = Math.min(discountCents, total);
    const raw = lineValuesCents.map((v) => (toSplit * v) / total);
    const result = raw.map((r) => Math.floor(r));
    let leftover = toSplit - result.reduce((a, b) => a + b, 0);
    // Hand the leftover kuruş to the largest fractional parts first.
    const byFrac = raw
      .map((r, i) => ({ i, frac: r - Math.floor(r) }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; leftover > 0 && byFrac.length > 0; k++, leftover--) {
      result[byFrac[k % byFrac.length].i] += 1;
    }
    return result;
  }

  /**
   * Map a Payment.method (CASH/CARD/DIGITAL, case-insensitive) to the GMP-3
   * fiscal tender category. Cash is the one legally-distinct category; every
   * electronic tender is non-cash (card), with wallet/QR mapped to `qr`.
   */
  private toFiscalTender(method: string): "cash" | "card" | "qr" {
    switch ((method ?? "").toUpperCase()) {
      case "CASH":
        return "cash";
      case "DIGITAL":
        return "qr";
      default:
        return "card";
    }
  }
}
