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
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as Sentry from '@sentry/node';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentsService } from '../../orders/services/payments.service';
import { PaytrAdapter } from '../../payments/adapters/paytr.adapter';
import { CustomerSessionService } from '../../customers/customer-session.service';
import { CreatePayIntentDto } from '../dto/pay-intent.dto';
import { OrderStatus, PaymentStatus } from '../../../common/constants/order-status.enum';

const INTENT_TTL_MINUTES = 60;
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

  // ──────────────────────────────────────────────────────────────────
  // READ: table-wide payable items for the session's table
  // ──────────────────────────────────────────────────────────────────

  async getPayableItemsForSession(sessionId: string) {
    const session = await this.customerSessionService.requireSession(sessionId);

    // Surface the toggle in the read response too so the QR menu
    // can hide the "Pay Now" button on tenants that haven't opted
    // in. The createPayIntent path will also enforce it server-side
    // — this is a UX-layer convenience.
    const [posSettings, tenant] = await Promise.all([
      this.prisma.posSettings.findUnique({
        where: { tenantId: session.tenantId },
        select: { enableCustomerSelfPay: true },
      }),
      this.prisma.tenant.findUnique({
        where: { id: session.tenantId },
        select: { paymentRegion: true },
      }),
    ]);
    const selfPayEnabled =
      !!posSettings?.enableCustomerSelfPay && tenant?.paymentRegion === 'TURKEY';

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

    const orderViews = orders.map((o) => {
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
        // Clamp to >= 0 — a stale intent could theoretically reserve
        // more than what's left if the data got out of sync.
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

    // Comma-separated regex patterns; absent → no override allowed.
    const allowedRaw = this.config.get<string>('PAYTR_ALLOWED_RETURN_ORIGINS') ?? '';
    const patterns = allowedRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const matches = patterns.some((p) => {
      try {
        return new RegExp(`^${p}$`).test(origin);
      } catch {
        return false;
      }
    });

    if (!matches) return { okUrl: fallbackOk, failUrl: fallbackFail };

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
    if (tenant.paymentRegion !== 'TURKEY') {
      throw new BadRequestException(
        'Self-pay is currently available for Turkey-region tenants only.',
      );
    }

    // Tenant-owner opt-in: even Turkey-region tenants need to flip
    // the toggle in POS settings before customers can self-pay. This
    // is a deliberate guard so a restaurant without a PayTR merchant
    // account doesn't surface a button that will only ever fail.
    const posSettings = await this.prisma.posSettings.findUnique({
      where: { tenantId: session.tenantId },
      select: { enableCustomerSelfPay: true },
    });
    if (!posSettings?.enableCustomerSelfPay) {
      throw new BadRequestException(
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

    // Reservations held by other in-flight PayTR intents on this
    // order. A second customer picking the same units 5 seconds
    // after the first hits a 409 here instead of double-paying.
    const orderIdsTouched = Array.from(new Set(requested.map((i) => i.orderId)));
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

    // Persist intent BEFORE PayTR call so the webhook can find it
    // even if the response races back faster than our DB write.
    const intent = await this.prisma.pendingSelfPayment.create({
      data: {
        merchantOid,
        sessionId,
        tenantId: session.tenantId,
        itemsByOrder: Array.from(itemsByOrder.values()) as any,
        amount: totalAmount,
        status: 'PENDING',
        customerPhone: dto.customerPhone,
        expiresAt,
      },
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
      // PayTR rejects synthetic emails on TLDs it can't deliver to
      // (e.g. .local is reserved). Use a safely-non-routable but
      // syntactically valid domain. PayTR also validates phone format
      // loosely; "0500..." is closer to a valid mobile shape than
      // "0000000000" which gets bounced by some merchants.
      const safeEmail = dto.customerPhone
        ? `${dto.customerPhone.replace(/\D/g, '')}@noreply.invalid`
        : `${sessionId.slice(0, 8)}@noreply.invalid`;
      const safePhone = dto.customerPhone || '05000000000';

      const result = await this.paytrAdapter.getIframeToken({
        merchantOid,
        amount: totalAmount,
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
        currency: 'TRY',
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
      await this.prisma.pendingSelfPayment.update({
        where: { id: intent.id },
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
      await this.prisma.pendingSelfPayment.update({
        where: { id: intent.id },
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
