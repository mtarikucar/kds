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
  ) {}

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
}
