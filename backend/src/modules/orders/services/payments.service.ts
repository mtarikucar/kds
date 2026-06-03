import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
  Logger,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { CreatePaymentDto } from "../dto/create-payment.dto";
import { SplitBillDto, SplitType } from "../dto/split-bill.dto";
import { PayItemsDto } from "../dto/pay-items.dto";
import {
  PaymentStatus,
  OrderStatus,
  StockMovementType,
} from "../../../common/constants/order-status.enum";
import { TableStatus } from "../../tables/dto/create-table.dto";
import { OrdersService } from "./orders.service";
import { CustomersService } from "../../customers/customers.service";
import { LoyaltyService } from "../../customers/loyalty.service";
import { StockDeductionService } from "../../stock-management/services/stock-deduction.service";
import { withTransaction, addBreadcrumb } from "../../../common/utils/tracing";
import * as Sentry from "@sentry/node";
import { SalesInvoiceService } from "../../accounting/services/sales-invoice.service";
import { AccountingSettingsService } from "../../accounting/services/accounting-settings.service";
import { ReceiptSnapshotBuilder } from "./receipt-snapshot.builder";
import { KdsGateway } from "../../kds/kds.gateway";
import { BranchScope, branchScope } from "../../../common/scoping/branch-scope";

// v2.8.97 — single source of truth for the cross-payment-path rounding
// tolerance. Both the single-payment overpayment check and the
// split-bill exact-match check accept ±1 kuruş for float-legacy callers
// computing finalAmount client-side. Defining the value once means a
// future audit/refactor doesn't have to chase two hardcoded literals.
const PAYMENT_TOLERANCE = new Prisma.Decimal("0.01");

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private ordersService: OrdersService,
    private customersService: CustomersService,
    private receiptSnapshotBuilder: ReceiptSnapshotBuilder,
    private loyaltyService: LoyaltyService,
    @Optional()
    private salesInvoiceService?: SalesInvoiceService,
    @Optional()
    private accountingSettingsService?: AccountingSettingsService,
    @Optional()
    @Inject(forwardRef(() => StockDeductionService))
    private stockDeductionService?: StockDeductionService,
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
  private safeEmitPaymentSuccess(
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
  private async acquireOrderLock(
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
   *
   * @param tx             active transaction client
   * @param order          the order being closed (id, tableId, customerId,
   *                       customerPhone, finalAmount, tenantId)
   * @param customerPhone  optional phone to link/create a customer
   * @param closingAmount  amount to credit to customer's totalSpent
   *                       (= order.finalAmount; passed explicitly so
   *                       callers reuse a Decimal already in scope)
   */
  private async finalizeFullyPaid(
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
  private async creditLoyaltyForFinalizedOrder(
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
  private async buildReceiptSnapshotForPayment(
    tx: Prisma.TransactionClient,
    orderId: string,
    tenantId: string,
    paymentInputs: { method: string; transactionId: string | null },
  ): Promise<Prisma.InputJsonValue | typeof Prisma.JsonNull> {
    try {
      // Early-exit on tenant lookup miss so we don't burn a wasted
      // order.findFirst (also keeps test mock sequences stable —
      // every extra prisma call inside the helper would shift the
      // `mockResolvedValueOnce` cursor of every payByItems spec).
      const tenantRow = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, currency: true },
      });
      if (!tenantRow) return Prisma.JsonNull;
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
      if (!orderForSnap) return Prisma.JsonNull;
      return this.receiptSnapshotBuilder.buildReceiptSnapshot({
        tenant: tenantRow,
        order: ReceiptSnapshotBuilder.toBuilderOrder(orderForSnap),
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
  private async linkCustomerForPayment(
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
  private async maybeGenerateAutoInvoice(
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

  async create(
    orderId: string,
    createPaymentDto: CreatePaymentDto,
    tenantId: string,
    initiatedByUserId: string | null = null,
  ) {
    return withTransaction(
      {
        name: "payment.create",
        op: "payment",
        tags: {
          "payment.method": createPaymentDto.method,
          "tenant.id": tenantId,
          "order.id": orderId,
        },
        data: {
          amount: createPaymentDto.amount,
        },
      },
      async () => {
        addBreadcrumb("Starting payment creation", "payment", {
          orderId,
          amount: createPaymentDto.amount,
        });

        // Verify order exists and belongs to tenant (lightweight pre-check for tenant isolation)
        await this.ordersService.findOneByTenant(orderId, tenantId);

        addBreadcrumb("Payment validation passed", "payment", { orderId });

        // Idempotency fast-path: if the client supplied a key and we've already
        // recorded a payment for this (orderId, key), return that row instead of
        // creating a duplicate. The DB has a partial unique index on
        // (orderId, idempotencyKey) WHERE idempotencyKey IS NOT NULL — this
        // pre-check is a responsiveness optimization; P2002 below handles the
        // concurrent-retry race authoritatively.
        if (createPaymentDto.idempotencyKey) {
          const existing = await this.prisma.payment.findFirst({
            where: {
              orderId,
              tenantId,
              idempotencyKey: createPaymentDto.idempotencyKey,
            },
            include: {
              order: {
                include: {
                  orderItems: { include: { product: true } },
                },
              },
            },
          });
          if (existing) return existing;
        }

        // Create payment and update order status in a transaction
        let result;
        try {
          result = await this.prisma.$transaction(async (tx) => {
            // Serialize concurrent payment paths on the same order.
            await this.acquireOrderLock(tx, orderId, tenantId);

            // Re-fetch order inside transaction for a consistent view
            const order = await tx.order.findFirst({
              where: { id: orderId, tenantId },
            });

            if (!order) {
              throw new NotFoundException("Order not found");
            }

            // Check if order is already paid (inside transaction to prevent race condition)
            if (order.status === OrderStatus.PAID) {
              throw new BadRequestException("Order is already paid");
            }

            // Check if order is cancelled
            if (order.status === OrderStatus.CANCELLED) {
              throw new BadRequestException("Cannot pay for a cancelled order");
            }

            // Prevent payment for orders awaiting approval (check BEFORE creating payment)
            if (
              order.requiresApproval &&
              order.status === OrderStatus.PENDING_APPROVAL
            ) {
              throw new BadRequestException(
                "Order requires approval before payment can be processed. Please approve the order first.",
              );
            }

            // PosSettings.requireServedForDineInPayment gates dine-in
            // payments on order.status === SERVED — opt-in for tenants
            // who want the waiter to confirm the food landed before
            // taking money. Tenants who leave the toggle off keep the
            // legacy "pay anytime" behaviour.
            if (
              order.type === "DINE_IN" &&
              order.status !== OrderStatus.SERVED
            ) {
              // v3.0.1 — findFirst (Prisma rejects compound-unique with
              // branchId: null even when DB allows it; see branch-scope helper).
              const posSettings = await tx.posSettings.findFirst({
                where: { tenantId, branchId: null },
                select: { requireServedForDineInPayment: true },
              });
              if (posSettings?.requireServedForDineInPayment) {
                throw new BadRequestException(
                  "Order must be SERVED before payment (tenant policy: requireServedForDineInPayment).",
                );
              }
            }

            // Validate payment amount against REMAINING (not total). A partial
            // payment must not be allowed to push the order into overpayment by
            // sending a second full-amount payment.
            const existingPaid = await tx.payment.aggregate({
              where: { orderId, status: PaymentStatus.COMPLETED },
              _sum: { amount: true },
            });
            const alreadyPaid = new Prisma.Decimal(
              existingPaid._sum.amount ?? 0,
            );
            const remaining = new Prisma.Decimal(order.finalAmount).sub(
              alreadyPaid,
            );
            // ±PAYMENT_TOLERANCE rounding tolerance for float-legacy callers.
            if (
              new Prisma.Decimal(createPaymentDto.amount).gt(
                remaining.add(PAYMENT_TOLERANCE),
              )
            ) {
              throw new BadRequestException(
                `Payment amount exceeds remaining (${remaining.toFixed(2)})`,
              );
            }

            // Build the receipt snapshot before payment.create so it's persisted
            // in the same transaction. Fail-soft: if tenant or order data is
            // unexpectedly missing pieces, fall back to JsonNull rather than
            // crashing the payment — this is a reprint convenience, not the
            // source of truth for accounting.
            const receiptSnapshot = await this.buildReceiptSnapshotForPayment(
              tx,
              orderId,
              tenantId,
              {
                method: createPaymentDto.method,
                transactionId: createPaymentDto.transactionId ?? null,
              },
            );

            // Create payment
            const payment = await tx.payment.create({
              data: {
                amount: createPaymentDto.amount,
                method: createPaymentDto.method,
                status: PaymentStatus.COMPLETED,
                notes: createPaymentDto.notes,
                orderId,
                tenantId,
                // v3.0.0 — branchId is now required (NOT NULL on Payment).
                // Derive from the order being paid so the payment stays in the
                // same branch as the order — staff at branch B can never book
                // a payment that lands on a foreign branch's books.
                branchId: order.branchId,
                paidAt: new Date(),
                // Persist external gateway reference + client-provided idempotency
                // key so retries of the same request return the same payment row
                // (enforced by the partial unique index on the schema side).
                transactionId: createPaymentDto.transactionId,
                idempotencyKey: createPaymentDto.idempotencyKey,
                receiptSnapshot,
              },
              include: {
                order: {
                  include: {
                    orderItems: {
                      include: {
                        product: true,
                      },
                    },
                  },
                },
              },
            });

            // Check if total payments equal or exceed order amount
            const totalPaid = await tx.payment.aggregate({
              where: {
                orderId,
                status: PaymentStatus.COMPLETED,
              },
              _sum: {
                amount: true,
              },
            });

            // Stay in Decimal end-to-end on the "are we fully paid?" check.
            // Number conversion drops precision on totals > ~$70k, which
            // could let a still-short order flip to PAID (M1).
            const totalPaidAmount = new Prisma.Decimal(
              totalPaid._sum.amount ?? 0,
            );
            const orderAmount = new Prisma.Decimal(order.finalAmount);

            if (totalPaidAmount.gte(orderAmount)) {
              await this.finalizeFullyPaid(
                tx,
                order,
                createPaymentDto.customerPhone,
                orderAmount,
              );
            }

            addBreadcrumb("Payment completed successfully", "payment", {
              paymentId: payment.id,
            });
            return payment;
          });
        } catch (err) {
          // Partial unique index on (orderId, idempotencyKey) WHERE key IS NOT
          // NULL — a concurrent retry with the same key races to insert and
          // only one wins. Losers surface the already-stored payment so the
          // client gets an idempotent response.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002" &&
            createPaymentDto.idempotencyKey
          ) {
            const existing = await this.prisma.payment.findFirst({
              where: {
                orderId,
                tenantId,
                idempotencyKey: createPaymentDto.idempotencyKey,
              },
              include: {
                order: {
                  include: {
                    orderItems: { include: { product: true } },
                  },
                },
              },
            });
            if (existing) return existing;
          }
          throw err;
        }

        // Auto-generate invoice AFTER transaction commits. The helper
        // already does bounded retry + Sentry tagging
        // (REVENUE_SYNC_FAILED) so the receipt-snapshot branch's
        // inline copy is no longer needed — kept the helper because
        // splitBill and payByItems share it too.
        await this.maybeGenerateAutoInvoice(orderId, tenantId);
        await this.creditLoyaltyForFinalizedOrder(orderId, tenantId);
        this.safeEmitPaymentSuccess(tenantId, result, initiatedByUserId);

        return result;
      },
    );
  }

  async findByOrder(orderId: string, tenantId: string) {
    // Verify order exists and belongs to tenant
    await this.ordersService.findOneByTenant(orderId, tenantId);

    // Defence-in-depth: also filter payments by tenantId. The pre-check
    // above ensures the order is the caller's, but a future regression
    // (e.g. removing the pre-check or fetching by something other than
    // orderId) would re-introduce IDOR. The compound filter makes the
    // call safe in isolation.
    return this.prisma.payment.findMany({
      where: { orderId, tenantId },
      orderBy: { createdAt: "desc" },
    });
  }

  // Valid payment status transitions
  private static readonly VALID_PAYMENT_TRANSITIONS: Record<
    PaymentStatus,
    PaymentStatus[]
  > = {
    [PaymentStatus.PENDING]: [PaymentStatus.COMPLETED, PaymentStatus.FAILED],
    [PaymentStatus.COMPLETED]: [PaymentStatus.REFUNDED],
    [PaymentStatus.FAILED]: [],
    [PaymentStatus.REFUNDED]: [],
  };

  async updateStatus(id: string, status: PaymentStatus, tenantId: string) {
    // Pre-filter by tenantId so the lookup itself rejects cross-tenant
    // IDs — the prior implementation fetched by id alone, then validated
    // the tenant via a separate ordersService.findOne() call. That two-step
    // pattern created a window where an attacker who guessed a foreign
    // payment id could race past the validation. One atomic query, no race.
    const payment = await this.prisma.payment.findFirst({
      where: { id, tenantId },
      include: {
        order: true,
      },
    });

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    // Validate payment state transition
    const currentStatus = payment.status as PaymentStatus;
    const validTransitions =
      PaymentsService.VALID_PAYMENT_TRANSITIONS[currentStatus] || [];
    if (!validTransitions.includes(status)) {
      throw new BadRequestException(
        `Invalid payment status transition: ${currentStatus} -> ${status}. Allowed: ${validTransitions.join(", ") || "none"}`,
      );
    }

    // REFUNDED requires rolling back the order + customer stats atomically.
    // Previously this endpoint flipped payment.status alone, leaving the
    // order as PAID and the customer's lifetime spend inflated — so
    // reports, loyalty, and accounting all drifted.
    if (status === PaymentStatus.REFUNDED) {
      // Track whether the refund flipped the order out of PAID so we can
      // run stock reversal AFTER the tx commits (mirrors the pattern in
      // orders.service.ts:719-728). Doing it inside the tx would tie the
      // cancellation to the success of an external stock service.
      let orderMovedToCancelled = false;
      const result = await this.prisma.$transaction(
        async (tx) => {
          // Atomic claim: filtering on status=COMPLETED prevents a double-tap
          // refund click from both passing the (stale) VALID_TRANSITIONS check
          // above and both deducting from customer stats. The findUnique used
          // for that validation runs outside this tx and can race with another
          // request flipping status; updateMany + count check serializes them.
          //
          // Serializable isolation (set on $transaction below) covers the
          // SEPARATE race where two refunds of DIFFERENT payments of the
          // SAME order both reach this tx — without it, the customer-stats
          // read-modify-write at line ~849 would lose-update (both read
          // totalOrders=N, both write N-1).
          const refundResult = await tx.payment.updateMany({
            where: { id, status: PaymentStatus.COMPLETED },
            data: { status: PaymentStatus.REFUNDED, paidAt: null },
          });
          if (refundResult.count === 0) {
            throw new BadRequestException(
              "Payment is no longer refundable (state changed mid-flight)",
            );
          }

          // Free the per-item allocations linked to this payment. The
          // OrderItemPayment.amount snapshot stays in the Payment audit
          // (Payment is not deleted, only flipped to REFUNDED), but the
          // units become payable again because subsequent reads filter on
          // payment.status = COMPLETED.
          //
          // Filter by paymentId alone: the Payment row was already
          // authenticated by tenantId at line 376, and a tenantId guard
          // here would silently strand rows in the (impossible-today
          // but possible-tomorrow) world where allocation.tenantId
          // drifts from payment.tenantId.
          await tx.orderItemPayment.deleteMany({
            where: { paymentId: id },
          });
          const updated = await tx.payment.findUnique({ where: { id } });

          const completedSum = await tx.payment.aggregate({
            where: {
              orderId: payment.orderId,
              status: PaymentStatus.COMPLETED,
            },
            _sum: { amount: true },
          });
          const stillPaid = new Prisma.Decimal(completedSum._sum.amount ?? 0);
          const orderAmount = new Prisma.Decimal(payment.order.finalAmount);

          // If the remaining completed payments no longer cover the order,
          // we need to back the order out of PAID. The right target state
          // depends on whether ANY completed payment survives the refund:
          //
          //  - Other completed payments exist (typical for progressive
          //    flow: A and B already paid for their share, C refunds his)
          //    → drop back to SERVED. Table stays OCCUPIED. The remaining
          //    customers' allocations are intact; the items C originally
          //    paid for are re-payable. NO stock reversal — the order is
          //    not cancelled, the food was served.
          //
          //  - Zero completed payments left (the refunded payment was the
          //    only one; the order was paid in a single Payment.create
          //    that has now been refunded) → CANCELLED + stock reversal.
          //    This is the legacy single-payment flow.
          //
          // Customer-stats rollback is always per-Payment.amount, never
          // per-order finalAmount — only the refunded payment's
          // contribution should be undone.
          if (
            stillPaid.lt(orderAmount) &&
            payment.order.status === OrderStatus.PAID
          ) {
            const otherCompletedCount = await tx.payment.count({
              where: {
                orderId: payment.orderId,
                status: PaymentStatus.COMPLETED,
                id: { not: id },
              },
            });

            if (otherCompletedCount === 0) {
              // Full unwind: nothing left, treat as if the order was cancelled.
              await tx.order.update({
                where: { id: payment.orderId },
                data: {
                  status: OrderStatus.CANCELLED,
                  paidAt: null,
                  cancelledAt: new Date(),
                },
              });
              orderMovedToCancelled = true;
            } else {
              // Partial unwind: there are still paying customers. Back
              // the order to SERVED and keep the table occupied. Don't
              // touch cancelledAt; this is not a cancellation.
              await tx.order.update({
                where: { id: payment.orderId },
                data: {
                  status: OrderStatus.SERVED,
                  paidAt: null,
                },
              });
              if (payment.order.tableId) {
                // v2.8.93 — updateMany with (id, tenantId) compound WHERE.
                // Same cross-tenant write risk as the AVAILABLE branch in
                // finalizeFullyPaid above; mirror the fix here.
                await tx.table.updateMany({
                  where: {
                    id: payment.order.tableId,
                    tenantId: payment.order.tenantId,
                  },
                  data: { status: TableStatus.OCCUPIED },
                });
              }
            }

            // Roll back THIS payment's contribution to customer stats —
            // regardless of which branch we took.
            if (payment.order.customerId) {
              // v2.8.93 — tenantId-scoped lookup matches finalizeFullyPaid.
              const cust = await tx.customer.findFirst({
                where: {
                  id: payment.order.customerId,
                  tenantId: payment.order.tenantId,
                },
              });
              if (cust && cust.totalOrders > 0) {
                const refundedAmt = new Prisma.Decimal(payment.amount);
                const newTotalOrders = Math.max(0, cust.totalOrders - 1);
                const newTotalSpent = Prisma.Decimal.max(
                  new Prisma.Decimal(0),
                  new Prisma.Decimal(cust.totalSpent).sub(refundedAmt),
                );
                const newAverage =
                  newTotalOrders > 0
                    ? newTotalSpent.div(newTotalOrders)
                    : new Prisma.Decimal(0);
                await tx.customer.updateMany({
                  where: { id: cust.id, tenantId: payment.order.tenantId },
                  data: {
                    totalOrders: newTotalOrders,
                    totalSpent: newTotalSpent,
                    averageOrder: newAverage,
                  },
                });
              }
            }
          }

          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      // Reverse the stock deductions the original PAID transition booked.
      // Until 2026-05-11 the refund flow silently left stock decremented
      // even though the order was now CANCELLED — inventory drifted.
      if (orderMovedToCancelled && this.stockDeductionService) {
        try {
          await this.stockDeductionService.reverseForOrder(
            payment.orderId,
            tenantId,
          );
        } catch (err: any) {
          this.logger.error(
            `CRITICAL: stock reversal failed for refunded order ${payment.orderId}: ${err.message}`,
            err.stack,
          );
          Sentry.captureException(err, {
            tags: { event: "REFUND_STOCK_REVERSAL_FAILED", tenantId },
            extra: { orderId: payment.orderId, paymentId: id },
          });
        }
      }

      return result;
    }

    // Defence-in-depth: tenantId in the WHERE so a regression of the
    // findFirst pre-check at line 705 can't expose cross-tenant writes
    // on non-refund transitions (e.g. COMPLETED → FAILED).
    const claim = await this.prisma.payment.updateMany({
      where: { id, tenantId },
      data: {
        status,
        paidAt: status === PaymentStatus.COMPLETED ? new Date() : null,
      },
    });
    if (claim.count === 0) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }
    // Defence-in-depth — the compound updateMany above proved tenant
    // ownership; keep the same compound WHERE on the post-write read so
    // a future reorder of these steps can't regress into a cross-tenant
    // leak (same pattern as the inner-tx writes at L894 above).
    return this.prisma.payment.findFirstOrThrow({ where: { id, tenantId } });
  }

  // ========================================
  // SPLIT BILL
  // ========================================

  async splitBill(
    orderId: string,
    dto: SplitBillDto,
    tenantId: string,
    initiatedByUserId: string | null = null,
  ) {
    // Pre-validate order exists and is in valid state
    const preCheck = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!preCheck) {
      throw new NotFoundException("Order not found");
    }

    if (preCheck.status === OrderStatus.PAID) {
      throw new BadRequestException("Order is already fully paid");
    }

    if (preCheck.status === OrderStatus.CANCELLED) {
      throw new BadRequestException("Cannot pay for a cancelled order");
    }

    // All validation and payment creation inside transaction for race-condition safety
    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent payment paths on the same order so two
      // simultaneous splits can't both pass the remaining-amount check.
      await this.acquireOrderLock(tx, orderId, tenantId);

      const order = await tx.order.findFirst({
        where: { id: orderId, tenantId },
        include: {
          orderItems: { include: { product: true } },
          payments: { where: { status: PaymentStatus.COMPLETED } },
        },
      });

      if (!order) {
        throw new NotFoundException("Order not found");
      }

      // Decimal-clean tolerance check. The earlier JS-Number implementation
      // accumulated rounding error: a 0.005-per-line drift over 20 split
      // entries could slip a real overpayment through (or block a legit
      // exact-cent split). Stay in Decimal until the final compare.
      const orderAmount = new Prisma.Decimal(order.finalAmount);
      const alreadyPaid = order.payments.reduce<Prisma.Decimal>(
        (sum, p) => sum.add(new Prisma.Decimal(p.amount)),
        new Prisma.Decimal(0),
      );
      const remaining = orderAmount.sub(alreadyPaid);

      const totalSplitAmount = dto.payments.reduce<Prisma.Decimal>(
        (sum, p) => sum.add(new Prisma.Decimal(p.amount)),
        new Prisma.Decimal(0),
      );

      // Split total must match the remaining amount within 1 kuruş — both
      // directions. The original implementation only rejected overpayment,
      // which let a 100.00 TL bill be settled as [50.00, 49.99] and silently
      // marked PAID with 0.01 TL outstanding — systematic revenue loss when
      // it happens at scale.
      const diff = totalSplitAmount.sub(remaining).abs();
      if (diff.gt(PAYMENT_TOLERANCE)) {
        const direction = totalSplitAmount.gt(remaining)
          ? "exceeds"
          : "is below";
        throw new BadRequestException(
          `Split total (${totalSplitAmount.toFixed(2)}) ${direction} remaining amount (${remaining.toFixed(2)})`,
        );
      }

      // Per-entry idempotency. Use the explicit key from the DTO when the
      // client supplied one; otherwise derive a stable key from the batch
      // key + position index so a network retry of the whole split-bill
      // body recovers the same payments instead of duplicating them. The
      // partial unique index `payments_orderId_idempotencyKey_notnull_key`
      // (migration 20260420180000) is the authoritative dedupe — P2002
      // resolves to the existing row on retry.
      const batchKey = dto.idempotencyKey;
      // Track which entries were freshly inserted vs. recovered from
      // a P2002 idempotent retry. Only fresh inserts emit
      // payment:success — a recovered row already fired its socket
      // event on the original call, so re-emitting on retry would
      // duplicate prints + cash-drawer pops on every Tauri tablet.
      const payments: Array<
        Awaited<ReturnType<typeof tx.payment.create>> & { __replayed?: boolean }
      > = [];
      for (const [idx, entry] of dto.payments.entries()) {
        const key =
          entry.idempotencyKey ?? (batchKey ? `${batchKey}:${idx}` : undefined);
        try {
          // Per-split snapshot so each entry in the split has its own
          // reprintable fiş. Method differs per entry (one diner cash,
          // next card etc.) so the snapshot is rebuilt per loop.
          const receiptSnapshot = await this.buildReceiptSnapshotForPayment(
            tx,
            orderId,
            tenantId,
            { method: entry.method, transactionId: null },
          );
          const payment = await tx.payment.create({
            data: {
              amount: entry.amount,
              method: entry.method,
              status: PaymentStatus.COMPLETED,
              notes: entry.label || null,
              orderId: orderId,
              tenantId,
              // v3.0.0 — required branchId, derived from the order so every
              // split entry settles in the order's branch (no cross-branch
              // leak even if a stray request reached the wrong terminal).
              branchId: order.branchId,
              paidAt: new Date(),
              idempotencyKey: key,
              receiptSnapshot,
            },
          });
          payments.push(payment);
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002" &&
            key
          ) {
            const existing = await tx.payment.findFirst({
              where: { orderId, tenantId, idempotencyKey: key },
            });
            if (existing) {
              // Tag so the post-tx emit loop skips this entry.
              // `Object.assign` keeps the type compatible with the
              // existing `payments` array shape.
              payments.push(Object.assign(existing, { __replayed: true }));
              continue;
            }
          }
          throw err;
        }
      }

      // Check if order is fully paid now
      const totalPaid = await tx.payment.aggregate({
        where: { orderId: orderId, status: PaymentStatus.COMPLETED },
        _sum: { amount: true },
      });

      // Decimal compare — M2 changed `orderAmount` above to Decimal; this
      // sibling check must also stay in Decimal or the >= will be on
      // mixed types and throw at runtime / typecheck.
      const totalPaidAmount = new Prisma.Decimal(totalPaid._sum.amount ?? 0);
      const isFullyPaid = totalPaidAmount.gte(orderAmount);

      if (isFullyPaid) {
        // Preserve pre-refactor splitBill semantics: customer stats
        // were NOT bumped here. payByItems opts in, create() always
        // bumped — splitBill stays opt-out to avoid a behaviour drift
        // on the first deploy.
        await this.finalizeFullyPaid(
          tx,
          order,
          dto.customerPhone,
          orderAmount,
          {
            bumpCustomerStats: false,
          },
        );
      }

      return { payments, isFullyPaid };
    });

    // Auto-generate invoice AFTER transaction commits
    if (result.isFullyPaid) {
      await this.maybeGenerateAutoInvoice(orderId, tenantId);
      await this.creditLoyaltyForFinalizedOrder(orderId, tenantId);
    }
    // Emit per-payment so each Tauri terminal prints its own fiş.
    // Skip replayed entries (P2002 recovery): the original call
    // already emitted, a duplicate would print the same fiş twice.
    for (const p of result.payments) {
      if ((p as any).__replayed) continue;
      this.safeEmitPaymentSuccess(tenantId, p, initiatedByUserId);
    }

    // Strip the internal `__replayed` dedup tag before handing the
    // payments array to the controller — it's a server-side concern
    // (suppresses double-emit on a P2002 retry) and must not leak
    // into the HTTP response shape.
    const cleanedPayments = result.payments.map((p) => {
      const { __replayed, ...rest } = p as typeof p & { __replayed?: boolean };
      return rest;
    });

    return {
      orderId: orderId,
      splitType: dto.splitType,
      payments: cleanedPayments,
      orderFullyPaid: result.isFullyPaid,
    };
  }

  // ========================================
  // PROGRESSIVE ("DUTCH-STYLE") PAYMENTS
  // ========================================

  /**
   * Per-unit pre-discount value for an OrderItem.
   *
   * NOTE on tax: prices in this codebase are KDV-INCLUSIVE
   * (orders.service.ts:190-198 — `subtotal = qty * (price + modifierTotal)`,
   * then `taxAmount` is *extracted* from that subtotal via
   * `taxCalculationService.extractTax`). So `subtotal` already contains
   * both modifier value and tax — we MUST NOT add `taxAmount` or
   * `modifierTotal` on top, or every per-item payment overstates by
   * the embedded tax (and double-counts modifiers).
   * Likewise `order.totalAmount = sum(orderItem.subtotal)`.
   */
  /**
   * Public wrapper used by the customer self-pay path (QR-menu PayTR
   * flow) to compute the amount it will charge before requesting a
   * PayTR token. Mirrors the per-unit math used inside payByItems so
   * the server-side amount is consistent across staff and customer
   * payment paths.
   *
   * Returns the discount-adjusted per-unit value of an OrderItem
   * (subtotal/quantity × discountMultiplier). Caller scales by qty.
   */
  public derivePerUnitNet(
    item: { quantity: number; subtotal: Prisma.Decimal | number | string },
    order: {
      discount: Prisma.Decimal | number | string;
      totalAmount: Prisma.Decimal | number | string;
    },
  ): Prisma.Decimal {
    return this.perUnitGross(item).mul(this.discountMultiplier(order));
  }

  private perUnitGross(item: {
    quantity: number;
    subtotal: Prisma.Decimal | number | string;
  }): Prisma.Decimal {
    if (item.quantity <= 0) return new Prisma.Decimal(0);
    return new Prisma.Decimal(item.subtotal).div(item.quantity);
  }

  /**
   * Order-level discount multiplier so per-item math distributes the
   * discount pro-rata across line items. `order.discount` is the only
   * order-level discount today; it applies against `order.totalAmount`
   * (pre-discount). Returns `1 - discount/totalAmount`, clamped to [0,1].
   */
  private discountMultiplier(order: {
    discount: Prisma.Decimal | number | string;
    totalAmount: Prisma.Decimal | number | string;
  }): Prisma.Decimal {
    const totalAmount = new Prisma.Decimal(order.totalAmount);
    if (totalAmount.lte(0)) return new Prisma.Decimal(1);
    const ratio = new Prisma.Decimal(order.discount).div(totalAmount);
    const factor = new Prisma.Decimal(1).sub(ratio);
    if (factor.lt(0)) return new Prisma.Decimal(0);
    if (factor.gt(1)) return new Prisma.Decimal(1);
    return factor;
  }

  /**
   * Discount-adjusted total for an OrderItem (all units). See the tax
   * note on `perUnitGross` — `subtotal` is the authoritative total
   * value of the item (KDV-inclusive, modifier-inclusive).
   */
  private itemTotalWithDiscount(
    item: { subtotal: Prisma.Decimal | number | string },
    order: {
      discount: Prisma.Decimal | number | string;
      totalAmount: Prisma.Decimal | number | string;
    },
  ): Prisma.Decimal {
    return new Prisma.Decimal(item.subtotal).mul(
      this.discountMultiplier(order),
    );
  }

  /**
   * Settle specific OrderItem units in a single Payment. Lets a customer
   * pay only for what they personally ordered ("Alman usulü") and walk
   * away while the rest of the table stays open. The amount is derived
   * server-side from the items list — the DTO has no `amount` field so
   * the client cannot influence the total it gets charged.
   *
   * On commit:
   *  - One Payment row (status=COMPLETED) is created.
   *  - One OrderItemPayment row per entry records which units were
   *    settled (and the snapshot amount).
   *  - If the order is now fully paid, `finalizeFullyPaid` runs the
   *    same PAID transition the other two payment paths use.
   *
   * Idempotency: same partial unique index as `create()` / `splitBill()`.
   */
  async payByItems(
    orderId: string,
    dto: PayItemsDto,
    tenantId: string,
    initiatedByUserId: string | null = null,
  ) {
    return withTransaction(
      {
        name: "payment.payByItems",
        op: "payment",
        tags: {
          "payment.method": dto.method,
          "tenant.id": tenantId,
          "order.id": orderId,
        },
        data: { items: dto.items.length },
      },
      async () => {
        addBreadcrumb("Starting per-item payment", "payment", {
          orderId,
          items: dto.items.length,
        });

        // Lightweight existence check to fail fast on cross-tenant ids.
        await this.ordersService.findOneByTenant(orderId, tenantId);

        // Idempotency fast-path: if the key already maps to a payment,
        // rebuild and return the response from that row's allocations.
        if (dto.idempotencyKey) {
          const existing = await this.prisma.payment.findFirst({
            where: { orderId, tenantId, idempotencyKey: dto.idempotencyKey },
            include: { orderItemPayments: true },
          });
          if (existing) {
            const remaining = await this.getPayableItems(orderId, tenantId);
            return {
              payment: existing,
              itemAllocations: existing.orderItemPayments.map((a) => ({
                orderItemId: a.orderItemId,
                quantity: a.quantity,
                amount: a.amount.toFixed(2),
              })),
              orderFullyPaid: remaining.remainingQuantity === 0,
              remaining,
            };
          }
        }

        let payment: Awaited<ReturnType<typeof this.prisma.payment.create>>;
        let isFullyPaid = false;
        let allocations: Array<{
          orderItemId: string;
          quantity: number;
          amount: string;
        }>;
        let replayedFromInnerCatch = false;

        try {
          const txResult = await this.prisma.$transaction(async (tx) => {
            await this.acquireOrderLock(tx, orderId, tenantId);

            const order = await tx.order.findFirst({
              where: { id: orderId, tenantId },
              include: { orderItems: true },
            });

            if (!order) {
              throw new NotFoundException("Order not found");
            }
            if (order.status === OrderStatus.PAID) {
              throw new BadRequestException("Order is already paid");
            }
            if (order.status === OrderStatus.CANCELLED) {
              throw new BadRequestException("Cannot pay for a cancelled order");
            }
            if (
              order.requiresApproval &&
              order.status === OrderStatus.PENDING_APPROVAL
            ) {
              throw new BadRequestException(
                "Order requires approval before payment can be processed. Please approve the order first.",
              );
            }

            // Validate that every entry references a real OrderItem on this order.
            const itemsById = new Map(
              order.orderItems.map((i) => [i.id, i] as const),
            );
            for (const entry of dto.items) {
              const item = itemsById.get(entry.orderItemId);
              if (!item) {
                throw new BadRequestException(
                  `OrderItem ${entry.orderItemId} does not belong to this order`,
                );
              }
            }

            // Reject duplicate orderItemIds in the same request — would
            // make residual-allocation rounding ambiguous.
            const seen = new Set<string>();
            for (const entry of dto.items) {
              if (seen.has(entry.orderItemId)) {
                throw new BadRequestException(
                  `Duplicate orderItemId ${entry.orderItemId} in items list — combine into one entry`,
                );
              }
              seen.add(entry.orderItemId);
            }

            // Sum already-paid quantities per OrderItem (only COMPLETED payments count).
            const paidAgg = await tx.orderItemPayment.groupBy({
              by: ["orderItemId"],
              where: {
                tenantId,
                orderItem: { orderId },
                payment: { status: PaymentStatus.COMPLETED },
              },
              _sum: { quantity: true },
            });
            const paidByItem = new Map<string, number>(
              paidAgg.map((r) => [r.orderItemId, r._sum.quantity ?? 0]),
            );

            // Pending PayTR self-pay intents reserve units. The waiter
            // calling payByItems should not be able to take cash for
            // items a customer is currently paying for via PayTR —
            // both would book Payments and the second one's webhook
            // would 0-remaining-fail with no auto-refund. Read directly
            // (separate scope = single-query, race window is tiny vs.
            // the 1h intent TTL).
            const pendingIntents = await tx.pendingSelfPayment.findMany({
              where: {
                tenantId,
                status: "PENDING",
                expiresAt: { gt: new Date() },
              },
              select: { itemsByOrder: true },
            });
            const reservedByItem = new Map<string, number>();
            for (const intent of pendingIntents) {
              const buckets = intent.itemsByOrder as Array<{
                orderId: string;
                items?: Array<{ orderItemId: string; quantity: number }>;
              }>;
              if (!Array.isArray(buckets)) continue;
              for (const bucket of buckets) {
                if (bucket.orderId !== orderId) continue;
                for (const it of bucket.items || []) {
                  reservedByItem.set(
                    it.orderItemId,
                    (reservedByItem.get(it.orderItemId) ?? 0) + it.quantity,
                  );
                }
              }
            }

            // Validate that requested quantities don't exceed remaining.
            for (const entry of dto.items) {
              const item = itemsById.get(entry.orderItemId)!;
              const alreadyPaid = paidByItem.get(entry.orderItemId) ?? 0;
              const reserved = reservedByItem.get(entry.orderItemId) ?? 0;
              if (
                reserved > 0 &&
                entry.quantity > item.quantity - alreadyPaid - reserved
              ) {
                throw new ConflictException(
                  `Item ${entry.orderItemId} has ${reserved} unit(s) currently being paid by a customer via PayTR — wait for that intent to finalize (up to 15 minutes) before collecting at the POS.`,
                );
              }
              const remaining = item.quantity - alreadyPaid;
              if (entry.quantity > remaining) {
                throw new BadRequestException(
                  `Item ${entry.orderItemId} has ${remaining} units remaining, cannot pay for ${entry.quantity}`,
                );
              }
            }

            // Derive the payment amount and per-entry allocation amounts.
            // When this entry closes the last remaining unit of an item,
            // its amount absorbs the rounding residual so per-payment
            // totals reconcile exactly to itemTotal × discount-factor.
            const allocationRows: {
              orderItemId: string;
              quantity: number;
              amount: Prisma.Decimal;
            }[] = [];
            let derivedTotal = new Prisma.Decimal(0);
            for (const entry of dto.items) {
              const item = itemsById.get(entry.orderItemId)!;
              const alreadyPaid = paidByItem.get(entry.orderItemId) ?? 0;
              const isLastUnits =
                alreadyPaid + entry.quantity === item.quantity;

              let entryAmount: Prisma.Decimal;
              if (isLastUnits) {
                // Subtract every prior allocation's amount from the
                // discount-adjusted item total. Guarantees the order
                // closes at exactly finalAmount.
                const itemTotal = this.itemTotalWithDiscount(item, order);
                const priorAgg = await tx.orderItemPayment.aggregate({
                  where: {
                    orderItemId: item.id,
                    payment: { status: PaymentStatus.COMPLETED },
                  },
                  _sum: { amount: true },
                });
                const priorSum = new Prisma.Decimal(priorAgg._sum.amount ?? 0);
                entryAmount = itemTotal.sub(priorSum);
                if (entryAmount.lt(0)) entryAmount = new Prisma.Decimal(0);
              } else {
                const perUnit = this.perUnitGross(item).mul(
                  this.discountMultiplier(order),
                );
                entryAmount = perUnit.mul(entry.quantity);
              }
              // Round to 2dp for the snapshot.
              entryAmount = entryAmount.toDecimalPlaces(2);
              allocationRows.push({
                orderItemId: entry.orderItemId,
                quantity: entry.quantity,
                amount: entryAmount,
              });
              derivedTotal = derivedTotal.add(entryAmount);
            }

            // Build the per-payment receipt snapshot so this Payment
            // row carries a reprintable fiş — same artifact as the
            // legacy single-payment path. Customer self-pay (PayTR
            // webhook → payByItems) and waiter progressive flow both
            // get a snapshot. Failure inside the helper degrades to
            // JsonNull rather than blocking the payment.
            const receiptSnapshot = await this.buildReceiptSnapshotForPayment(
              tx,
              orderId,
              tenantId,
              { method: dto.method, transactionId: dto.transactionId ?? null },
            );

            // Create the Payment row.
            try {
              payment = await tx.payment.create({
                data: {
                  amount: derivedTotal,
                  method: dto.method,
                  status: PaymentStatus.COMPLETED,
                  notes: dto.notes,
                  orderId,
                  tenantId,
                  // v3.0.0 — required branchId. Order is the authoritative
                  // source of branch scope for every payment that closes it
                  // (waiter cash, customer self-pay via PayTR webhook etc.).
                  branchId: order.branchId,
                  paidAt: new Date(),
                  transactionId: dto.transactionId,
                  idempotencyKey: dto.idempotencyKey,
                  receiptSnapshot,
                },
              });
            } catch (err) {
              if (
                err instanceof Prisma.PrismaClientKnownRequestError &&
                err.code === "P2002" &&
                dto.idempotencyKey
              ) {
                const existing = await tx.payment.findFirst({
                  where: {
                    orderId,
                    tenantId,
                    idempotencyKey: dto.idempotencyKey,
                  },
                  include: { orderItemPayments: true },
                });
                if (existing) {
                  // Concurrent retry collided on the idempotency key; reuse
                  // the winning payment. The order's PAID/remaining state
                  // is re-derived from the fresh summary fetched outside
                  // the tx — the original call (or another writer) already
                  // ran finalizeFullyPaid if it was the closing payment.
                  return {
                    payment: existing,
                    allocations: existing.orderItemPayments.map((a) => ({
                      orderItemId: a.orderItemId,
                      quantity: a.quantity,
                      amount: a.amount.toFixed(2),
                    })),
                    isFullyPaid: false,
                    replayed: true,
                  };
                }
              }
              throw err;
            }

            // Insert the per-item allocation rows.
            await tx.orderItemPayment.createMany({
              data: allocationRows.map((row) => ({
                paymentId: payment.id,
                orderItemId: row.orderItemId,
                quantity: row.quantity,
                amount: row.amount,
                tenantId,
                // v3.0.0 — branchId required on the join row too so
                // per-branch revenue queries on OrderItemPayment don't
                // need a join through Payment. Derived from the order
                // (same branch as the parent Payment by construction).
                branchId: order.branchId,
              })),
            });

            // Per-payment CRM linkage. Each diner's phone goes to
            // THEIR Customer record with stats bumped by ONLY this
            // payment's amount (not the whole order finalAmount as
            // the legacy single-payment flow does).
            if (dto.customerPhone) {
              await this.linkCustomerForPayment(
                tx,
                {
                  id: payment.id,
                  orderId,
                  tenantId,
                  amount: payment.amount,
                },
                dto.customerPhone,
              );
            }

            // Check whether the order is now fully paid.
            const totalPaid = await tx.payment.aggregate({
              where: { orderId, status: PaymentStatus.COMPLETED },
              _sum: { amount: true },
            });
            const totalPaidAmount = new Prisma.Decimal(
              totalPaid._sum.amount ?? 0,
            );
            const orderAmount = new Prisma.Decimal(order.finalAmount);
            const fullyPaid = totalPaidAmount.gte(orderAmount);

            if (fullyPaid) {
              // bumpCustomerStats:false because each progressive
              // payment already did its own per-customer bump above.
              // We don't want the closing payment to double-count.
              await this.finalizeFullyPaid(
                tx,
                order,
                dto.customerPhone,
                orderAmount,
                {
                  bumpCustomerStats: false,
                },
              );
            }

            return {
              payment,
              allocations: allocationRows.map((r) => ({
                orderItemId: r.orderItemId,
                quantity: r.quantity,
                amount: r.amount.toFixed(2),
              })),
              isFullyPaid: fullyPaid,
              replayed: false,
            };
          });

          payment = txResult.payment;
          allocations = txResult.allocations;
          // On an in-tx idempotent replay, the original call (or a
          // concurrent writer) already ran finalizeFullyPaid if it
          // was the closing payment — we re-derive that from the
          // remaining-items summary below instead of trusting the
          // (always-false) inner replay flag.
          isFullyPaid = txResult.isFullyPaid;
          replayedFromInnerCatch = txResult.replayed;
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002" &&
            dto.idempotencyKey
          ) {
            const existing = await this.prisma.payment.findFirst({
              where: { orderId, tenantId, idempotencyKey: dto.idempotencyKey },
              include: { orderItemPayments: true },
            });
            if (existing) {
              const remaining = await this.getPayableItems(orderId, tenantId);
              return {
                payment: existing,
                itemAllocations: existing.orderItemPayments.map((a) => ({
                  orderItemId: a.orderItemId,
                  quantity: a.quantity,
                  amount: a.amount.toFixed(2),
                })),
                orderFullyPaid: remaining.remainingQuantity === 0,
                remaining,
              };
            }
          }
          throw err;
        }

        const remaining = await this.getPayableItems(orderId, tenantId);
        // Authoritative "fully paid" derives from the freshly-read
        // summary. An in-tx idempotency replay returns isFullyPaid=false
        // by design (we no longer trust the inner branch's flag).
        const orderFullyPaid = isFullyPaid || remaining.remainingQuantity === 0;

        // Every successful payByItems gets its own per-Payment fatura
        // (Turkish e-fatura compliance: customer-A's invoice carries
        // A's payment method + only the items A bought). Idempotent
        // against the partial unique on SalesInvoice.paymentId — a
        // replay returns the existing invoice.
        if (!replayedFromInnerCatch) {
          await this.maybeGenerateAutoInvoice(orderId, tenantId, payment.id);
          await this.creditLoyaltyForFinalizedOrder(orderId, tenantId);
          // Tell the POS to auto-print + open cash drawer (Tauri).
          // Skip the emit on idempotent replay — the first call
          // already fired and a second print would duplicate.
          this.safeEmitPaymentSuccess(tenantId, payment, initiatedByUserId);
        }

        addBreadcrumb("Per-item payment completed", "payment", {
          paymentId: payment.id,
          orderFullyPaid,
        });

        return {
          payment,
          itemAllocations: allocations,
          orderFullyPaid,
          remaining,
        };
      },
    );
  }

  /**
   * Per-item paid / remaining view used by the progressive payment UI.
   * Pure read; safe to call from a polling client (though we expect
   * websocket invalidation, not polling, on the actual frontend).
   */
  /**
   * Write off the remaining balance on an order as a house loss.
   * Used by managers to close abandoned tables, comp meals, or absorb
   * disputes — anywhere the restaurant is eating the cost rather than
   * trying to collect.
   *
   * Mechanics:
   *  - Creates a single Payment with method = HOUSE, amount = exact
   *    remaining (finalAmount − sum(completed payments)), notes = reason.
   *  - Calls finalizeFullyPaid with bumpCustomerStats:false so the
   *    write-off doesn't pollute customer.totalSpent (no real money
   *    changed hands; the customer who didn't pay shouldn't get loyalty
   *    credit for the unpaid portion).
   *  - Order flips to PAID, table is released, auto-invoice fires
   *    via the same path as a normal close.
   *
   * Idempotent against the same `idempotencyKey` (defaults to a
   * deterministic value if not supplied so an accidental double-click
   * doesn't create two HOUSE payments).
   */
  async writeOff(
    orderId: string,
    dto: { reason?: string; idempotencyKey?: string },
    tenantId: string,
    initiatedByUserId: string | null = null,
  ) {
    return withTransaction(
      {
        name: "payment.writeOff",
        op: "payment",
        tags: { "tenant.id": tenantId, "order.id": orderId },
      },
      async () => {
        addBreadcrumb("Starting write-off", "payment", {
          orderId,
          reason: dto.reason,
        });

        await this.ordersService.findOneByTenant(orderId, tenantId);

        // Idempotency fast-path
        const idemKey = dto.idempotencyKey ?? `writeoff:${orderId}`;
        const existing = await this.prisma.payment.findFirst({
          where: { orderId, tenantId, idempotencyKey: idemKey },
        });
        if (existing) {
          return {
            payment: existing,
            orderFullyPaid: true,
            writtenOffAmount: existing.amount.toFixed(2),
          };
        }

        const result = await this.prisma.$transaction(async (tx) => {
          await this.acquireOrderLock(tx, orderId, tenantId);

          const order = await tx.order.findFirst({
            where: { id: orderId, tenantId },
          });
          if (!order) throw new NotFoundException("Order not found");
          if (order.status === OrderStatus.PAID) {
            throw new BadRequestException("Order is already paid in full");
          }
          if (order.status === OrderStatus.CANCELLED) {
            throw new BadRequestException("Cannot write off a cancelled order");
          }

          const completedSum = await tx.payment.aggregate({
            where: { orderId, status: PaymentStatus.COMPLETED },
            _sum: { amount: true },
          });
          const alreadyPaid = new Prisma.Decimal(completedSum._sum.amount ?? 0);
          const finalAmount = new Prisma.Decimal(order.finalAmount);
          const remaining = finalAmount.sub(alreadyPaid);
          if (remaining.lte(0)) {
            throw new BadRequestException(
              "Nothing to write off — the order is already fully paid.",
            );
          }

          // House-loss payments need a snapshot too — they're still
          // a payment row in the audit trail and some jurisdictions
          // require a fiş line for write-offs.
          const receiptSnapshot = await this.buildReceiptSnapshotForPayment(
            tx,
            orderId,
            tenantId,
            { method: "HOUSE", transactionId: null },
          );

          let payment: Awaited<ReturnType<typeof tx.payment.create>>;
          try {
            payment = await tx.payment.create({
              data: {
                amount: remaining,
                method: "HOUSE",
                status: PaymentStatus.COMPLETED,
                notes: dto.reason ?? "House write-off",
                orderId,
                tenantId,
                // v3.0.0 — required branchId. HOUSE write-offs still need
                // a branch (manager at branch A absorbing a no-show on an
                // order opened at branch A); deriving from the order keeps
                // that consistent regardless of where the manager logs in.
                branchId: order.branchId,
                paidAt: new Date(),
                idempotencyKey: idemKey,
                receiptSnapshot,
              },
            });
          } catch (err) {
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === "P2002"
            ) {
              const dup = await tx.payment.findFirst({
                where: { orderId, tenantId, idempotencyKey: idemKey },
              });
              if (dup) return { payment: dup, fullyPaid: true };
            }
            throw err;
          }

          // No bumpCustomerStats — this isn't real revenue. Also no
          // customerPhone — write-off has no payer to link.
          await this.finalizeFullyPaid(tx, order, undefined, finalAmount, {
            bumpCustomerStats: false,
          });

          return { payment, fullyPaid: true };
        });

        // Per-payment fatura for the HOUSE line — passing paymentId
        // so it goes through createFromPayment, not createFromOrder.
        // Without paymentId, an order that already had per-payment
        // fataralar for diners A/B would also generate an order-level
        // invoice double-counting the same line items.
        await this.maybeGenerateAutoInvoice(
          orderId,
          tenantId,
          result.payment.id,
        );
        await this.creditLoyaltyForFinalizedOrder(orderId, tenantId);
        this.safeEmitPaymentSuccess(
          tenantId,
          result.payment,
          initiatedByUserId,
        );

        addBreadcrumb("Write-off completed", "payment", {
          paymentId: result.payment.id,
        });

        return {
          payment: result.payment,
          orderFullyPaid: true,
          writtenOffAmount: result.payment.amount.toFixed(2),
        };
      },
    );
  }

  async getPayableItems(orderId: string, tenantId: string) {
    // Single query — the (id, tenantId) where filter is the same
    // tenancy check ordersService.findOne would do; folding them into
    // one round-trip saves a DB hit on the polling read path.
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: {
        orderItems: {
          include: {
            product: true,
            modifiers: { include: { modifier: true } },
            orderItemPayments: {
              where: { payment: { status: PaymentStatus.COMPLETED } },
            },
          },
        },
        payments: {
          where: { status: PaymentStatus.COMPLETED },
          orderBy: { createdAt: "asc" },
          include: { orderItemPayments: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    const finalAmount = new Prisma.Decimal(order.finalAmount);
    const paidAmount = order.payments.reduce<Prisma.Decimal>(
      (sum, p) => sum.add(new Prisma.Decimal(p.amount)),
      new Prisma.Decimal(0),
    );
    const remainingAmount = finalAmount.sub(paidAmount);

    const items = order.orderItems.map((item) => {
      const paidQuantity = item.orderItemPayments.reduce(
        (s, a) => s + a.quantity,
        0,
      );
      const remainingQuantity = item.quantity - paidQuantity;
      const perUnit = this.perUnitGross(item).mul(
        this.discountMultiplier(order),
      );
      // itemTotal is the authoritative discount-adjusted line total
      // used server-side for last-unit residual settlement. Exposing
      // it lets the UI display the same number the server will charge
      // (per-unit × quantity drifts on sub-kuruş rounding).
      const itemTotal = this.itemTotalWithDiscount(item, order);
      return {
        orderItemId: item.id,
        productName: item.product?.name ?? null,
        quantity: item.quantity,
        paidQuantity,
        remainingQuantity,
        unitPrice: new Prisma.Decimal(item.unitPrice).toFixed(2),
        unitTotal: perUnit.toFixed(2),
        itemTotal: itemTotal.toFixed(2),
        modifierLabels: (item.modifiers || [])
          .map((m) => m.modifier?.displayName || m.modifier?.name || "")
          .filter(Boolean),
      };
    });

    const remainingQuantity = items.reduce(
      (s, i) => s + i.remainingQuantity,
      0,
    );

    return {
      orderId: order.id,
      finalAmount: finalAmount.toFixed(2),
      paidAmount: paidAmount.toFixed(2),
      remainingAmount: remainingAmount.toFixed(2),
      remainingQuantity,
      items,
      payments: order.payments.map((p) => ({
        id: p.id,
        amount: new Prisma.Decimal(p.amount).toFixed(2),
        method: p.method,
        notes: p.notes,
        paidAt: p.paidAt,
        allocations: p.orderItemPayments.map((a) => ({
          orderItemId: a.orderItemId,
          quantity: a.quantity,
          amount: new Prisma.Decimal(a.amount).toFixed(2),
        })),
      })),
    };
  }

  async getGroupBillSummary(scope: BranchScope, groupId: string) {
    // v3.0.0 — branch-scoped: the table group, by construction, lives
    // in one branch; this gate stops a manager in branch A from
    // viewing a sister-branch's combined bill by coercion of groupId.
    const tables = await this.prisma.table.findMany({
      where: { groupId, ...branchScope(scope) },
      include: {
        orders: {
          where: {
            status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
          },
          include: {
            orderItems: {
              include: {
                product: true,
                modifiers: { include: { modifier: true } },
                // Per-item paid-quantity breakdown for the progressive
                // payment UI's tab strip across a merged-table group.
                orderItemPayments: {
                  where: { payment: { status: PaymentStatus.COMPLETED } },
                },
              },
            },
            payments: { where: { status: PaymentStatus.COMPLETED } },
          },
        },
      },
      orderBy: { number: "asc" },
    });

    if (tables.length === 0) {
      throw new NotFoundException("Table group not found");
    }

    const allOrders = tables.flatMap((t) => t.orders);
    const allItems = allOrders.flatMap((o) =>
      o.orderItems.map((item) => {
        const paidQuantity = (item.orderItemPayments || []).reduce(
          (s, a) => s + a.quantity,
          0,
        );
        return {
          id: item.id,
          orderId: o.id,
          orderNumber: o.orderNumber,
          tableNumber: tables.find((t) => t.id === o.tableId)?.number,
          productName: item.product?.name,
          quantity: item.quantity,
          paidQuantity,
          remainingQuantity: item.quantity - paidQuantity,
          unitPrice: Number(item.unitPrice),
          subtotal: Number(item.subtotal),
          modifiers: item.modifiers?.map((m) => ({
            name: m.modifier?.displayName || m.modifier?.name,
            price: Number(m.modifier?.priceAdjustment || 0),
          })),
        };
      }),
    );

    // Group bill totals in Decimal end-to-end so cross-table groups
    // crossing ~₺70k don't drift on the kuruş (Number loses precision
    // past 2^53/100 = ~₺90B but cumulative add/sub error shows up much
    // earlier when summing many invoices).
    const totalAmount = allOrders.reduce<Prisma.Decimal>(
      (sum, o) => sum.add(new Prisma.Decimal(o.finalAmount)),
      new Prisma.Decimal(0),
    );
    const totalPaid = allOrders.reduce<Prisma.Decimal>(
      (sum, o) =>
        sum.add(
          o.payments.reduce<Prisma.Decimal>(
            (ps, p) => ps.add(new Prisma.Decimal(p.amount)),
            new Prisma.Decimal(0),
          ),
        ),
      new Prisma.Decimal(0),
    );
    const remainingAmount = totalAmount.sub(totalPaid);

    return {
      groupId,
      tables: tables.map((t) => ({ id: t.id, number: t.number })),
      orders: allOrders.map((o) => {
        const paid = o.payments.reduce<Prisma.Decimal>(
          (s, p) => s.add(new Prisma.Decimal(p.amount)),
          new Prisma.Decimal(0),
        );
        return {
          id: o.id,
          orderNumber: o.orderNumber,
          tableId: o.tableId,
          finalAmount: Number(o.finalAmount),
          paidAmount: paid.toNumber(),
        };
      }),
      items: allItems,
      summary: {
        totalAmount: totalAmount.toNumber(),
        totalPaid: totalPaid.toNumber(),
        remainingAmount: remainingAmount.toNumber(),
      },
    };
  }
}
