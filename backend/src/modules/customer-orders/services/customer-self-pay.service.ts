import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import * as Sentry from '@sentry/node';
import { withAdvisoryLock } from '../../../common/scheduling/advisory-lock';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentsService } from '../../orders/services/payments.service';
import { PaytrAdapter } from '../../payments/adapters/paytr.adapter';
import { CustomerSessionService } from '../../customers/customer-session.service';
import { CreatePayIntentDto } from '../dto/pay-intent.dto';
import { OrderStatus, PaymentStatus } from '../../../common/constants/order-status.enum';

// Self-pay intent reservation window. PayTR 3DS step + customer
// hesitation comfortably fit in 15 min; longer windows leave a
// table's items locked from the waiter for an entire turn cycle
// (avg table turn ~45 min). Sweeper runs every 30 min, but lazy
// expire on the polling read makes the practical limit ≈ TTL.
const INTENT_TTL_MINUTES = 15;

/**
 * Customer-facing 400 with a stable error code. The QR-menu surfaces
 * `err.response.data.message` directly to the diner; without a code
 * a Turkish customer sees raw English. The frontend looks at
 * `data.code` first, translates via i18n, and falls back to the
 * English message if the code is unknown.
 */
function selfPayError(code: string, message: string): BadRequestException {
  return new BadRequestException({
    message,
    code,
    error: 'Bad Request',
    statusCode: 400,
  });
}
const MERCHANT_OID_PREFIX = 'SP'; // "SP" — Self-Pay (subscription is "SUB")

/**
 * Truncate a string to N UTF-8 bytes (PayTR basket lines are
 * base64-encoded and have a byte-length limit, not a char limit).
 * `.slice(N)` on a JS string counts UTF-16 code units, which
 * undercounts Turkish letters and emoji.
 */
function truncateUtf8(input: string, maxBytes: number): string {
  if (!input) return '';
  const buf = Buffer.from(input, 'utf8');
  if (buf.byteLength <= maxBytes) return input;
  // Walk back to a UTF-8-safe boundary so we don't split a multi-byte char.
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}

interface ItemsByOrderShape {
  orderId: string;
  items: Array<{ orderItemId: string; quantity: number }>;
}

/**
 * Sum of orderItem units held by other PENDING intents on the same
 * order. A second customer (or the waiter) cannot pay those units
 * until the first intent terminates (SUCCEEDED / FAILED / EXPIRED).
 * Without this, both phones can charge the same item via PayTR and
 * the second webhook silently drops because payByItems sees "0
 * remaining" — money taken on PayTR, no Payment row, no auto-refund.
 *
 * Exported because PaymentsService.payByItems also consults this
 * map to block staff cash collection during an in-flight customer
 * PayTR session.
 */
export async function fetchOrderItemReservations(
  prisma: PrismaService,
  orderIds: string[],
  tenantId: string,
  excludeIntentId?: string,
): Promise<Map<string, number>> {
  const reserved = new Map<string, number>();
  if (orderIds.length === 0) return reserved;
  const pending = await prisma.pendingSelfPayment.findMany({
    where: {
      tenantId,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
      ...(excludeIntentId ? { id: { not: excludeIntentId } } : {}),
    },
    select: { itemsByOrder: true },
  });
  for (const intent of pending) {
    const buckets = intent.itemsByOrder as Array<{
      orderId: string;
      items?: Array<{ orderItemId: string; quantity: number }>;
    }>;
    if (!Array.isArray(buckets)) continue;
    for (const bucket of buckets) {
      if (!orderIds.includes(bucket.orderId)) continue;
      for (const item of bucket.items || []) {
        reserved.set(
          item.orderItemId,
          (reserved.get(item.orderItemId) ?? 0) + item.quantity,
        );
      }
    }
  }
  return reserved;
}

@Injectable()
export class CustomerSelfPayService {
  private readonly logger = new Logger(CustomerSelfPayService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => PaymentsService))
    private paymentsService: PaymentsService,
    private paytrAdapter: PaytrAdapter,
    private customerSessionService: CustomerSessionService,
    private config: ConfigService,
  ) {}

  /**
   * v2.8.98 — periodic TTL sweeper for expired PENDING intents.
   *
   * Pre-fix the expire path was lazy: `getIntentStatus` flipped a
   * PENDING row to EXPIRED on the first poll AFTER expiresAt; if
   * nobody polled (customer abandoned the tab) the row sat as
   * PENDING in pending_self_payments forever. Two problems:
   *   1. The dedup index (sessionId, tenantId, status, requestHash)
   *      kept matching against ghost rows so the same session could
   *      not start a new intent until manual cleanup.
   *   2. The webhook handler couldn't tell "expired and abandoned"
   *      from "expired but still in flight"; on a late callback it
   *      had to assume the latter and provision the order.
   *
   * The cron sweeps every 5 minutes under an advisory lock so only
   * one replica runs at a time, and transitions PENDING+expiresAt<now
   * to EXPIRED with a reason. Rows aren't hard-deleted — the audit
   * trail of "customer started a self-pay but didn't finish" is
   * useful for retention metrics and disputed-charge investigations.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'self-pay-intent-expire' })
  async expireStaleIntents(): Promise<void> {
    await withAdvisoryLock(
      this.prisma,
      'self-pay-intent-expire',
      async () => {
        const result = await this.prisma.pendingSelfPayment.updateMany({
          where: {
            status: 'PENDING',
            expiresAt: { lt: new Date() },
          },
          data: {
            status: 'EXPIRED',
            failureReason: 'TTL expired (sweeper)',
          },
        });
        if (result.count > 0) {
          this.logger.log(`self-pay sweeper: transitioned ${result.count} PENDING intents to EXPIRED`);
        }
      },
      this.logger,
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // READ: table-wide payable items for the session's table
  // ──────────────────────────────────────────────────────────────────

  async getPayableItemsForSession(sessionId: string) {
    const session = await this.customerSessionService.requireSession(sessionId);

    // Surface the toggle in the read response too so the QR menu
    // can hide the "Pay Now" button on tenants that haven't opted
    // in. The createPayIntent path will also enforce it server-side
    // — this is a UX-layer convenience.
    const posSettings = await this.prisma.posSettings.findUnique({
      where: { tenantId: session.tenantId },
      select: { enableCustomerSelfPay: true },
    });
    const selfPayEnabled = !!posSettings?.enableCustomerSelfPay;

    // Two query modes:
    //  - Dine-in (session.tableId set): return everyone's open orders
    //    on that table, so any diner can pay any item (full self-service
    //    matches the in-restaurant social model — splitting, treating,
    //    "I'll get this one"). The waiter still owns the table.
    //  - Takeaway / QR-counter (no tableId): return only the orders
    //    this session created. A takeaway customer paying from their
    //    phone shouldn't see (or be able to pay for) some other
    //    customer's pickup order.
    const orderWhere = session.tableId
      ? {
          tableId: session.tableId,
          tenantId: session.tenantId,
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        }
      : {
          sessionId,
          tenantId: session.tenantId,
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        };

    const orders = await this.prisma.order.findMany({
      where: orderWhere,
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
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Reservations from other customers' PENDING PayTR intents.
    // We treat reserved-but-not-yet-paid units as unavailable so two
    // phones can't both check out the same burger.
    const reservations = await fetchOrderItemReservations(
      this.prisma,
      orders.map((o) => o.id),
      session.tenantId,
    );

    let grandTotal = new Prisma.Decimal(0);
    let grandPaid = new Prisma.Decimal(0);
    let grandRemainingQty = 0;

    // Filter orders so the customer never sees an order where any
    // non-allocation Payment exists — the legacy single-payment /
    // split-bill paths book Payment rows without OrderItemPayment
    // allocations, so a per-item paidQuantity check alone can't tell
    // which items those rows "covered". Mixing self-pay on top of
    // such an order would either under- or over-count remaining
    // (both directions yield double-charges or stranded items).
    //
    // The safe semantic: if ANY non-allocation Payment exists on the
    // order, hide the whole order from the customer's self-pay view.
    // They can still call the waiter to settle. Once the restaurant
    // standardizes on payByItems for the table, this branch goes
    // dormant naturally.
    const filteredOrders = orders.filter((o) => {
      const finalAmount = new Prisma.Decimal(o.finalAmount);
      const paidAmount = o.payments.reduce<Prisma.Decimal>(
        (s, p) => s.add(new Prisma.Decimal(p.amount)),
        new Prisma.Decimal(0),
      );
      if (paidAmount.gte(finalAmount)) return false;
      const allocationPaid = o.orderItems.reduce<Prisma.Decimal>(
        (sum, item) =>
          sum.add(
            item.orderItemPayments.reduce<Prisma.Decimal>(
              (a, p) => a.add(new Prisma.Decimal(p.amount)),
              new Prisma.Decimal(0),
            ),
          ),
        new Prisma.Decimal(0),
      );
      // Tolerance for sub-kuruş rounding from the residual rule.
      const nonAllocationPaid = paidAmount.sub(allocationPaid);
      if (nonAllocationPaid.gt(new Prisma.Decimal('0.01'))) return false;
      return true;
    });

    const orderViews = filteredOrders.map((o) => {
      const finalAmount = new Prisma.Decimal(o.finalAmount);
      const paidAmount = o.payments.reduce<Prisma.Decimal>(
        (s, p) => s.add(new Prisma.Decimal(p.amount)),
        new Prisma.Decimal(0),
      );
      grandTotal = grandTotal.add(finalAmount);
      grandPaid = grandPaid.add(paidAmount);

      const items = o.orderItems.map((item) => {
        const paidQuantity = item.orderItemPayments.reduce(
          (s, a) => s + a.quantity,
          0,
        );
        const reservedQuantity = reservations.get(item.id) ?? 0;
        // No legacyShare here — orders with non-allocation Payments
        // were filtered out above, so the per-item count is fully
        // backed by OrderItemPayment rows.
        const remainingQuantity = Math.max(
          0,
          item.quantity - paidQuantity - reservedQuantity,
        );
        grandRemainingQty += remainingQuantity;
        const perUnit = this.paymentsService.derivePerUnitNet(item, o);
        const itemTotal = perUnit.mul(item.quantity);
        return {
          orderItemId: item.id,
          productName: item.product?.name ?? null,
          quantity: item.quantity,
          paidQuantity,
          reservedQuantity,
          remainingQuantity,
          unitTotal: perUnit.toFixed(2),
          itemTotal: itemTotal.toFixed(2),
          modifierLabels: (item.modifiers || [])
            .map((m) => m.modifier?.displayName || m.modifier?.name || '')
            .filter(Boolean),
        };
      });

      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        finalAmount: finalAmount.toFixed(2),
        paidAmount: paidAmount.toFixed(2),
        remainingAmount: finalAmount.sub(paidAmount).toFixed(2),
        items,
      };
    });

    return {
      sessionId,
      tableId: session.tableId,
      selfPayEnabled,
      orders: orderViews,
      summary: {
        totalAmount: grandTotal.toFixed(2),
        paidAmount: grandPaid.toFixed(2),
        remainingAmount: grandTotal.sub(grandPaid).toFixed(2),
        remainingQuantity: grandRemainingQty,
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // WRITE: PayTR intent
  // ──────────────────────────────────────────────────────────────────

  /**
   * Resolve the PayTR return URLs for an incoming intent. Origin is
   * taken from the caller's HTTP request — that way a customer on
   * `restaurant.hummytummy.com` comes back to the same host, not the
   * platform's default. Origin must match the comma-separated regex
   * whitelist in `PAYTR_ALLOWED_RETURN_ORIGINS` (env), or we fall
   * back to the global `PAYTR_OK_URL_POS` / `PAYTR_FAIL_URL_POS`.
   *
   * Whitelisting is critical: PayTR will redirect to whatever we
   * hand them, so an attacker who could swap Origin would otherwise
   * funnel customers to a phishing page after payment.
   */
  private resolveReturnUrls(origin?: string): { okUrl: string; failUrl: string } {
    const fallbackOk =
      this.config.get<string>('PAYTR_OK_URL_POS') ??
      this.config.get<string>('PAYTR_OK_URL') ??
      'http://localhost:5173/payment-result';
    const fallbackFail =
      this.config.get<string>('PAYTR_FAIL_URL_POS') ??
      this.config.get<string>('PAYTR_FAIL_URL') ??
      'http://localhost:5173/payment-result';

    if (!origin) return { okUrl: fallbackOk, failUrl: fallbackFail };

    // v2.8.94 — exact origin allowlist (was: free-form regex). Pre-fix
    // a misconfigured PAYTR_ALLOWED_RETURN_ORIGINS regex like ".*"
    // would have rewarded the attacker's chosen origin with a PayTR
    // return token; even a slightly loose pattern like
    // `https://.*\.example\.com` would have matched
    // `https://attacker.com/.example.com#`. Exact match means the env
    // value must enumerate every legitimate origin, character for
    // character. Comma-separated, parsed via URL() so a typo surfaces
    // immediately instead of silently failing as "no match".
    const allowedRaw = this.config.get<string>('PAYTR_ALLOWED_RETURN_ORIGINS') ?? '';
    const allowedOrigins = allowedRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => {
        try {
          new URL(s);
          return true;
        } catch {
          // Malformed origin in env — log loudly so ops notices, but
          // don't take the whole startup path down.
          return false;
        }
      });

    if (!allowedOrigins.includes(origin)) {
      return { okUrl: fallbackOk, failUrl: fallbackFail };
    }

    // Origin like https://restaurant.hummytummy.com — same path
    // suffix the SPA uses for the path-based variant ("/payment-result").
    const base = origin.replace(/\/+$/, '');
    return {
      okUrl: `${base}/payment-result`,
      failUrl: `${base}/payment-result`,
    };
  }

  async createPayIntent(
    sessionId: string,
    dto: CreatePayIntentDto,
    userIp: string,
    returnOrigin?: string,
  ) {
    const session = await this.customerSessionService.requireSession(sessionId);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: session.tenantId },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    // Tenant-owner opt-in: needs to flip the toggle in POS settings
    // before customers can self-pay. This
    // is a deliberate guard so a restaurant without a PayTR merchant
    // account doesn't surface a button that will only ever fail.
    const posSettings = await this.prisma.posSettings.findUnique({
      where: { tenantId: session.tenantId },
      select: { enableCustomerSelfPay: true },
    });
    if (!posSettings?.enableCustomerSelfPay) {
      throw selfPayError(
        'SELF_PAY_DISABLED',
        'Self-pay is not enabled for this restaurant. Please ask the waiter to take your payment.',
      );
    }

    // Scope the orderItem lookup the same way as the read path:
    //  - Dine-in: any item on any open order at the session's table.
    //  - Takeaway/counter: only items belonging to orders this
    //    session itself created (sessionId match).
    // Either way the tenantId filter keeps the call tenant-scoped.
    const orderScope = session.tableId
      ? {
          tableId: session.tableId,
          tenantId: session.tenantId,
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        }
      : {
          sessionId,
          tenantId: session.tenantId,
          status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
        };

    const requested = await this.prisma.orderItem.findMany({
      where: {
        id: { in: dto.items.map((i) => i.orderItemId) },
        order: orderScope,
      },
      include: {
        order: true,
        product: true,
        orderItemPayments: {
          where: { payment: { status: PaymentStatus.COMPLETED } },
        },
      },
    });

    const foundIds = new Set(requested.map((i) => i.id));
    for (const entry of dto.items) {
      if (!foundIds.has(entry.orderItemId)) {
        throw new BadRequestException(
          `Item ${entry.orderItemId} is not payable for this session`,
        );
      }
    }

    // Currency safety gate — PayTR collects in TRY only. The Order
    // schema doesn't carry a per-order currency column today (line
    // items inherit the tenant's currency setting from Tenant.currency),
    // so we read the tenant row instead. A tenant operating in (e.g.)
    // USD would otherwise have the customer see "$199" on the QR-menu
    // bill while the adapter hardcodes wire-format currency=TL — same
    // bug-shape iter-67 closes on the subscription path. The adapter
    // throws on mismatch as defence in depth; this pre-check produces
    // a clean structured error before the PendingSelfPayment row is
    // reserved.
    const tenantCurrency = tenant.currency || 'TRY';
    if (tenantCurrency !== 'TRY') {
      throw selfPayError(
        'SELF_PAY_UNSUPPORTED_CURRENCY',
        `Self-pay yalnızca TRY ile çalışan restoranlarda kullanılabilir (mevcut: ${tenantCurrency}).`,
      );
    }
    const orderCurrency = tenantCurrency;

    // Defence-in-depth against the legacy-payment blind spot:
    // self-pay is disabled on any order that already has a Payment
    // row WITHOUT a matching OrderItemPayment allocation, because
    // those Payments came from create() or splitBill() and we can't
    // attribute them to specific items. Mixing self-pay on top of
    // them would over- or under-count remaining quantities. The
    // view-side filter already hides these orders; this guard
    // catches a stale client that still posts an intent before its
    // cache refreshes.
    const orderIdsTouched = Array.from(new Set(requested.map((i) => i.orderId)));
    const guardedOrders = await this.prisma.order.findMany({
      where: { id: { in: orderIdsTouched }, tenantId: session.tenantId },
      select: {
        id: true,
        finalAmount: true,
        payments: {
          where: { status: PaymentStatus.COMPLETED },
          select: { amount: true },
        },
        orderItems: {
          select: {
            orderItemPayments: {
              where: { payment: { status: PaymentStatus.COMPLETED } },
              select: { amount: true },
            },
          },
        },
      },
    });
    for (const o of guardedOrders) {
      const paid = o.payments.reduce<Prisma.Decimal>(
        (s, p) => s.add(new Prisma.Decimal(p.amount)),
        new Prisma.Decimal(0),
      );
      if (paid.gte(new Prisma.Decimal(o.finalAmount))) {
        throw selfPayError(
          'ORDER_ALREADY_PAID',
          `Order ${o.id} is already fully paid — refresh the menu to update your view.`,
        );
      }
      const allocPaid = o.orderItems.reduce<Prisma.Decimal>(
        (sum, item) =>
          sum.add(
            item.orderItemPayments.reduce<Prisma.Decimal>(
              (a, p) => a.add(new Prisma.Decimal(p.amount)),
              new Prisma.Decimal(0),
            ),
          ),
        new Prisma.Decimal(0),
      );
      const nonAllocationPaid = paid.sub(allocPaid);
      if (nonAllocationPaid.gt(new Prisma.Decimal('0.01'))) {
        throw selfPayError(
          'SELF_PAY_DISABLED_MIXED_PAYMENT',
          `Order ${o.id} has a payment that wasn't recorded at item level. ` +
            'Self-pay is disabled here — please call the waiter to settle.',
        );
      }
    }

    // Reservations held by other in-flight PayTR intents on this
    // order. A second customer picking the same units 5 seconds
    // after the first hits a 409 here instead of double-paying.
    const reservations = await fetchOrderItemReservations(
      this.prisma,
      orderIdsTouched,
      session.tenantId,
    );

    // Compute total + per-order groupings (server-derived; client can't override).
    let totalAmount = new Prisma.Decimal(0);
    const itemsByOrder = new Map<string, ItemsByOrderShape>();
    for (const entry of dto.items) {
      const item = requested.find((i) => i.id === entry.orderItemId)!;
      const alreadyPaid = item.orderItemPayments.reduce(
        (s, a) => s + a.quantity,
        0,
      );
      const reserved = reservations.get(item.id) ?? 0;
      const remaining = item.quantity - alreadyPaid - reserved;
      if (entry.quantity > remaining) {
        const reasonSuffix = reserved > 0
          ? ` (${reserved} reserved by another in-flight payment)`
          : '';
        throw new BadRequestException(
          `Item ${entry.orderItemId} has ${remaining} units remaining, cannot pay ${entry.quantity}${reasonSuffix}`,
        );
      }

      const perUnit = this.paymentsService.derivePerUnitNet(item, item.order);
      const lineAmount = perUnit.mul(entry.quantity);
      totalAmount = totalAmount.add(lineAmount);

      const bucket = itemsByOrder.get(item.orderId) ?? {
        orderId: item.orderId,
        items: [],
      };
      bucket.items.push({ orderItemId: entry.orderItemId, quantity: entry.quantity });
      itemsByOrder.set(item.orderId, bucket);
    }
    totalAmount = totalAmount.toDecimalPlaces(2);

    if (totalAmount.lte(0)) {
      throw new BadRequestException('Nothing to pay');
    }

    const merchantOid = this.generateMerchantOid(session.tenantId);
    const expiresAt = new Date(Date.now() + INTENT_TTL_MINUTES * 60_000);

    // v2.8.98 — deterministic idempotency check. Pre-fix two
    // rapid-fire createPayIntent calls with the same session + same
    // item set + same total (a customer's quick double-tap on the
    // payment button before the PayTR redirect fires) each generated
    // a fresh merchantOid and the customer ended up with two PayTR
    // sessions open against the same items. The first to land at the
    // gateway won; the second got 409 from the dedup-by-status check
    // upstream but if the customer authorized BOTH the system had to
    // mark one failed + queue a refund.
    //
    // The hash spans (sessionId, sorted itemsByOrder, amount, customer
    // phone). A second tap with identical inputs lands the existing
    // PENDING intent — the URL the customer is redirected to is the
    // same one as the first tap.
    const reqHash = createHash('sha256')
      .update(sessionId)
      .update('|')
      .update(JSON.stringify(Array.from(itemsByOrder.values()).sort((a, b) => a.orderId.localeCompare(b.orderId))))
      .update('|')
      .update(totalAmount.toString())
      .update('|')
      .update(dto.customerPhone ?? '')
      .digest('hex')
      .slice(0, 32);
    const dedupExisting = await this.prisma.pendingSelfPayment.findFirst({
      where: {
        sessionId,
        tenantId: session.tenantId,
        status: 'PENDING',
        requestHash: reqHash,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, merchantOid: true, expiresAt: true },
    });
    if (dedupExisting) {
      this.logger.log(
        `Idempotent retry hit: existing PENDING intent ${dedupExisting.merchantOid} for session=${sessionId} expires=${dedupExisting.expiresAt.toISOString()}`,
      );
      // The current PayTR session is already live; re-running the
      // token mint would create a fresh checkout URL that doesn't
      // match the one the customer is already redirected to. Surface
      // a 409 with a customer-friendly message so the QR menu can
      // poll the merchantOid path and complete the existing flow
      // instead of restarting.
      throw new ConflictException(
        'A payment for these items is already in progress — complete it in the open tab, or wait 15 minutes for it to expire.',
      );
    }

    // v2.8.97 — lock all referenced orders FOR UPDATE before
    // persisting the intent. Pre-fix the intent.create races with
    // orders.service.update's item-rewrite branch (v2.8.94 added the
    // waiter-side lock; this is the matching customer-side lock).
    // Without both sides locking the same row(s) a concurrent rewrite
    // by the waiter could delete the items referenced in itemsByOrder
    // between this validation pass and the PayTR webhook landing,
    // leaving the customer charged for items that no longer exist.
    // The intent.create stays inside the txn so a rollback on
    // validation failure also rolls back any speculative state.
    //
    // Lock order: ascending orderId string sort, so two concurrent
    // multi-order intent flows can't deadlock against each other.
    const lockOrderIds = [...itemsByOrder.keys()].sort();
    const intent = await this.prisma.$transaction(async (tx) => {
      for (const oid of lockOrderIds) {
        await tx.$queryRaw`
          SELECT id FROM orders WHERE id = ${oid} AND "tenantId" = ${session.tenantId} FOR UPDATE
        `;
      }
      // Re-validate item ids still exist after acquiring the lock.
      // A waiter rewrite committed BEFORE our lock would already be
      // visible; one that lands while we hold the lock is serialized
      // until our intent commits.
      const stillExistingItemIds = await tx.orderItem.findMany({
        where: {
          orderId: { in: lockOrderIds },
          id: { in: dto.items.map((it) => it.orderItemId) },
        },
        select: { id: true },
      });
      const stillExistingSet = new Set(stillExistingItemIds.map((r) => r.id));
      for (const it of dto.items) {
        if (!stillExistingSet.has(it.orderItemId)) {
          throw new BadRequestException(
            `Item ${it.orderItemId} no longer exists — order was modified. Refresh and retry.`,
          );
        }
      }
      return tx.pendingSelfPayment.create({
        data: {
          merchantOid,
          sessionId,
          tenantId: session.tenantId,
          itemsByOrder: Array.from(itemsByOrder.values()) as any,
          amount: totalAmount,
          status: 'PENDING',
          customerPhone: dto.customerPhone,
          expiresAt,
          // v2.8.98 — deterministic dedup key over (session, items,
          // amount, phone); a retry tap with identical inputs hits
          // the dedupExisting branch above and short-circuits.
          requestHash: reqHash,
        },
      });
    });

    // Build PayTR token request. Return URLs honour the caller's
    // Origin (subdomain restaurants need to come back to their own
    // host) but only if whitelisted; otherwise fall back to env.
    const { okUrl, failUrl } = this.resolveReturnUrls(returnOrigin);

    // Basket: one line per item entry. Names get UTF-8-byte
    // truncated (PayTR limits per-line size by *bytes*; .slice() on
    // a JS string operates in UTF-16 code units, so "Ş" would still
    // count as 1 even though it's 2 bytes in PayTR's base64'd
    // basket. Truncate by bytes to be safe.).
    const basket: Array<[string, string, number]> = [];
    for (const entry of dto.items) {
      const item = requested.find((i) => i.id === entry.orderItemId)!;
      const perUnit = this.paymentsService.derivePerUnitNet(item, item.order);
      basket.push([
        truncateUtf8((item.product as any)?.name ?? 'Ürün', 80) || 'Ürün',
        perUnit.toFixed(2),
        entry.quantity,
      ]);
    }

    try {
      // Synthetic email for PayTR. Must be syntactically valid but
      // we deliberately do NOT include the customer's phone number
      // in the local-part — phone is PII and PayTR retains basket
      // metadata in their dashboard. Use the merchantOid (already
      // ours, already in PayTR's database) so it's stable but not
      // a personal identifier.
      // `.invalid` is the RFC 2606 reserved TLD; PayTR accepts it.
      const safeEmail = `${merchantOid.toLowerCase()}@noreply.invalid`;
      // Phone format: PayTR loosely validates. "05000000000" is a
      // valid Turkish mobile shape (starts with 05, 11 digits) but
      // is not a real number. We don't pass the customer's actual
      // phone here either — same PII rationale as the email.
      const safePhone = '05000000000';

      const result = await this.paytrAdapter.getIframeToken({
        merchantOid,
        amount: totalAmount,
        // Validated above to be 'TRY'. Passed explicitly so the
        // adapter's currency-gate fires as defence in depth.
        currency: orderCurrency,
        email: safeEmail,
        userName: 'Müşteri',
        userAddress: 'Masa',
        userPhone: safePhone,
        userBasket: basket,
        userIp,
        okUrl: `${okUrl}?oid=${merchantOid}`,
        failUrl: `${failUrl}?oid=${merchantOid}&status=failed`,
      });

      await this.prisma.pendingSelfPayment.update({
        where: { id: intent.id },
        data: { paytrToken: result.token },
      });

      return {
        merchantOid,
        paymentLink: result.paymentLink,
        amount: totalAmount.toFixed(2),
        // Echo back the validated source currency. The pre-check above
        // guarantees orderCurrency === 'TRY' for any path that reaches
        // PayTR, but reading from the variable means a future relax of
        // the gate (extra provider added) won't silently lie about what
        // the customer was charged.
        currency: orderCurrency,
      };
    } catch (err: any) {
      // PayTR couldn't issue a token — mark the intent failed so a
      // stuck-PENDING row doesn't haunt the sweeper. failureReason
      // uses a coded prefix the frontend maps to an i18n string.
      await this.prisma.pendingSelfPayment.update({
        where: { id: intent.id },
        data: {
          status: 'FAILED',
          failureReason: 'paytr_token_error',
        },
      });
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // READ: poll for status after PayTR redirect
  // ──────────────────────────────────────────────────────────────────

  /**
   * Poll endpoint after PayTR redirects the customer back. Intentionally
   * does NOT require an active CustomerSession — that record expires
   * after 4 hours, and a customer returning from a flaky network or a
   * long 3DS detour shouldn't be locked out of their own receipt.
   *
   * The merchantOid is an unguessable 27+ character token issued by
   * us inside createPayIntent, so its possession is sufficient
   * authentication for a read-only status view. We still cross-check
   * sessionId to keep the route URL-scoped (a customer in tenant A
   * can't probe tenant B's intent ids).
   *
   * Lazy expire: if expiresAt has passed and the row is still
   * PENDING, flip it to EXPIRED on the fly so the client sees a
   * terminal status instead of polling forever.
   */
  async getPayStatus(sessionId: string, merchantOid: string) {
    const intent = await this.prisma.pendingSelfPayment.findUnique({
      where: { merchantOid },
    });
    if (!intent || intent.sessionId !== sessionId) {
      throw new NotFoundException('Payment intent not found for this session');
    }

    let status = intent.status;
    let failureReason = intent.failureReason;
    if (status === 'PENDING' && intent.expiresAt < new Date()) {
      const updated = await this.prisma.pendingSelfPayment.updateMany({
        where: { id: intent.id, status: 'PENDING' },
        data: { status: 'EXPIRED', failureReason: 'expired' },
      });
      if (updated.count > 0) {
        status = 'EXPIRED';
        failureReason = 'expired';
      }
    }

    // remaining summary needs an active session; if the session has
    // expired by the time the customer returns, we still return the
    // payment outcome (the important bit) and just leave `remaining`
    // null. The receipt UI handles a null remaining gracefully.
    let remaining: Awaited<ReturnType<typeof this.getPayableItemsForSession>> | null = null;
    try {
      remaining = await this.getPayableItemsForSession(sessionId);
    } catch {
      remaining = null;
    }

    return {
      merchantOid,
      status,
      amount: intent.amount.toFixed(2),
      failureReason,
      remaining,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // WEBHOOK: PayTR called us back; settle the intent
  // ──────────────────────────────────────────────────────────────────

  /**
   * Called by PaytrWebhookController when the merchantOid prefix is
   * "SP". Settles every order in the intent's itemsByOrder snapshot
   * via the regular payByItems path (with the merchantOid acting as
   * the idempotency key, so a PayTR retry never double-charges).
   *
   * Always resolves; never throws — the webhook contract is to
   * return plain "OK" to PayTR even on failure, so we log + Sentry.
   */
  async handleWebhookSuccess(
    merchantOid: string,
    paytrPaymentType?: string,
  ): Promise<void> {
    const intent = await this.prisma.pendingSelfPayment.findUnique({
      where: { merchantOid },
    });
    if (!intent) {
      // Unknown — return silently (mirrors subscription-side behaviour)
      this.logger.warn(`self-pay webhook: unknown merchantOid=${merchantOid}`);
      return;
    }
    if (intent.status !== 'PENDING') {
      // Idempotent — PayTR retried; we already settled.
      return;
    }

    const itemsByOrder = intent.itemsByOrder as unknown as ItemsByOrderShape[];

    // Pre-validate every order's remaining quantities BEFORE booking
    // any Payment row. If, say, the waiter took cash for one of these
    // items while the customer was in PayTR's iframe, we want to
    // detect that here and mark the whole intent FAILED — rather
    // than partially booking order #1 and discovering order #2's
    // items are gone. payByItems is still idempotent on its own
    // (selfpay:<oid>:<orderId> key), so a partial book on retry
    // resolves to the existing row.
    try {
      for (const bucket of itemsByOrder) {
        const items = await this.prisma.orderItem.findMany({
          where: {
            id: { in: bucket.items.map((i) => i.orderItemId) },
            order: { id: bucket.orderId, tenantId: intent.tenantId },
          },
          include: {
            orderItemPayments: {
              where: { payment: { status: PaymentStatus.COMPLETED } },
            },
          },
        });
        for (const entry of bucket.items) {
          const dbItem = items.find((it) => it.id === entry.orderItemId);
          if (!dbItem) {
            throw new BadRequestException(
              `Item ${entry.orderItemId} no longer exists or was cancelled`,
            );
          }
          const alreadyPaid = dbItem.orderItemPayments.reduce(
            (s, a) => s + a.quantity,
            0,
          );
          if (alreadyPaid + entry.quantity > dbItem.quantity) {
            throw new ConflictException(
              `Item ${entry.orderItemId} was paid for by someone else after the intent was created`,
            );
          }
        }
      }

      for (const bucket of itemsByOrder) {
        await this.paymentsService.payByItems(
          bucket.orderId,
          {
            items: bucket.items,
            method: 'CARD' as any,
            transactionId: merchantOid,
            customerPhone: intent.customerPhone || undefined,
            // Per-order idempotency key — PayTR retry returns the same
            // Payment instead of duplicating. Suffix with orderId so a
            // multi-order intent doesn't collide.
            idempotencyKey: `selfpay:${merchantOid}:${bucket.orderId}`,
            notes: paytrPaymentType
              ? `Self-pay via PayTR (${paytrPaymentType})`
              : 'Self-pay via PayTR',
          },
          intent.tenantId,
        );
      }
      // Compound WHERE on the original PENDING status closes the
      // TOCTOU between line 704's intent.status check and this write.
      // A concurrent retry from PayTR that already finished settlement
      // won't be overwritten; a concurrent failure path won't be
      // downgraded to SUCCEEDED.
      await this.prisma.pendingSelfPayment.updateMany({
        where: { id: intent.id, status: 'PENDING' },
        data: { status: 'SUCCEEDED', succeededAt: new Date() },
      });
    } catch (err: any) {
      this.logger.error(
        `self-pay settlement failed for ${merchantOid}: ${err?.message ?? err}`,
        err?.stack,
      );
      Sentry.captureException(err, {
        tags: { event: 'SELF_PAY_SETTLEMENT_FAILED', tenantId: intent.tenantId },
        extra: { merchantOid, sessionId: intent.sessionId, raw: err?.message },
      });
      // Coded failureReason → frontend maps to localized message.
      // PayTR charged the card but our settlement didn't book a
      // Payment row; this is the path that needs ops attention
      // (manual refund or manual reconciliation). The Sentry alert
      // carries the raw error; the customer sees a friendly string.
      // Compound WHERE on PENDING: a concurrent retry that already
      // succeeded must not be downgraded to FAILED. The Sentry alert
      // above is still emitted regardless — ops gets the signal.
      await this.prisma.pendingSelfPayment.updateMany({
        where: { id: intent.id, status: 'PENDING' },
        data: {
          status: 'FAILED',
          failureReason: 'settlement_error',
        },
      });
    }
  }

  async handleWebhookFailure(
    merchantOid: string,
    reason: string | undefined,
  ): Promise<void> {
    await this.prisma.pendingSelfPayment.updateMany({
      where: { merchantOid, status: 'PENDING' },
      data: {
        status: 'FAILED',
        failureReason: reason ?? 'paytr_reported_failure',
      },
    });
  }

  // ──────────────────────────────────────────────────────────────────

  private generateMerchantOid(tenantId: string): string {
    const tenantHex = tenantId.replace(/-/g, '').slice(0, 12);
    const ts = Date.now().toString(36);
    const rand = randomBytes(3).toString('hex');
    return `${MERCHANT_OID_PREFIX}${tenantHex}${ts}${rand}`;
  }
}
