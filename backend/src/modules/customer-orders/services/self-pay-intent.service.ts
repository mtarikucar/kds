import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { PrismaService } from "../../../prisma/prisma.service";
import { PaymentsService } from "../../orders/services/payments.service";
import { PaytrAdapter } from "../../payments/adapters/paytr.adapter";
import { CustomerSessionService } from "../../customers/customer-session.service";
import { CreatePayIntentDto } from "../dto/pay-intent.dto";
import {
  OrderStatus,
  PaymentStatus,
} from "../../../common/constants/order-status.enum";
import {
  INTENT_TTL_MINUTES,
  selfPayError,
  truncateUtf8,
} from "./self-pay-pricing.util";
import { generateMerchantOid } from "./self-pay-merchant-oid.util";
import { SelfPayReservationService } from "./self-pay-reservation.service";

interface ItemsByOrderShape {
  orderId: string;
  items: Array<{ orderItemId: string; quantity: number }>;
}

/**
 * Write side of customer self-pay: validate the requested items, reserve
 * them against a PendingSelfPayment row inside a single FOR-UPDATE
 * transaction, and mint the PayTR hosted-iframe token. Extracted from
 * CustomerSelfPayService verbatim — the entire $transaction (row locks,
 * post-lock re-validate, cross-branch assertion, intent.create) stays
 * inside this one service so the lock boundary is never split.
 */
@Injectable()
export class SelfPayIntentService {
  private readonly logger = new Logger(SelfPayIntentService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => PaymentsService))
    private paymentsService: PaymentsService,
    private paytrAdapter: PaytrAdapter,
    private customerSessionService: CustomerSessionService,
    private config: ConfigService,
    private reservations: SelfPayReservationService,
  ) {}

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
  private resolveReturnUrls(origin?: string): {
    okUrl: string;
    failUrl: string;
  } {
    const fallbackOk =
      this.config.get<string>("PAYTR_OK_URL_POS") ??
      this.config.get<string>("PAYTR_OK_URL") ??
      "http://localhost:5173/payment-result";
    const fallbackFail =
      this.config.get<string>("PAYTR_FAIL_URL_POS") ??
      this.config.get<string>("PAYTR_FAIL_URL") ??
      "http://localhost:5173/payment-result";

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
    const allowedRaw =
      this.config.get<string>("PAYTR_ALLOWED_RETURN_ORIGINS") ?? "";
    const allowedOrigins = allowedRaw
      .split(",")
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
    const base = origin.replace(/\/+$/, "");
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
    if (!tenant) throw new NotFoundException("Tenant not found");

    // Tenant-owner opt-in: needs to flip the toggle in POS settings
    // before customers can self-pay. This
    // is a deliberate guard so a restaurant without a PayTR merchant
    // account doesn't surface a button that will only ever fail.
    // v3.0.1 — findFirst (see branch-scope helper note).
    const posSettings = await this.prisma.posSettings.findFirst({
      where: { tenantId: session.tenantId, branchId: null },
      select: { enableCustomerSelfPay: true },
    });
    if (!posSettings?.enableCustomerSelfPay) {
      throw selfPayError(
        "SELF_PAY_DISABLED",
        "Self-pay is not enabled for this restaurant. Please ask the waiter to take your payment.",
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
    const tenantCurrency = tenant.currency || "TRY";
    if (tenantCurrency !== "TRY") {
      throw selfPayError(
        "SELF_PAY_UNSUPPORTED_CURRENCY",
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
    const orderIdsTouched = Array.from(
      new Set(requested.map((i) => i.orderId)),
    );
    const guardedOrders = await this.prisma.order.findMany({
      where: { id: { in: orderIdsTouched }, tenantId: session.tenantId },
      select: {
        id: true,
        // v3.0.0 — every order's branchId rides through to the
        // PendingSelfPayment row created below. A multi-order intent
        // must span only one branch (a single self-pay can't straddle
        // two physical kitchens); we assert this just before the
        // create.
        branchId: true,
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
    // Paid-in-full + non-allocation mixed-payment guard (shared with the
    // read-side hide rule). Throws ORDER_ALREADY_PAID /
    // SELF_PAY_DISABLED_MIXED_PAYMENT in the original order.
    this.reservations.assertOrdersSettleable(guardedOrders);

    // Reservations held by other in-flight PayTR intents on this
    // order. A second customer picking the same units 5 seconds
    // after the first hits a 409 here instead of double-paying.
    const reservations = await this.reservations.fetchOrderItemReservations(
      orderIdsTouched,
      session.tenantId,
    );

    // Reject duplicate orderItemIds BEFORE pricing. Each iteration below
    // derives `remaining` from the same alreadyPaid/reserved snapshot, so two
    // entries for the same item both pass the remaining check and DOUBLE the
    // PayTR charge. Worse, the settlement webhook calls payByItems whose
    // resolveItemsById rejects duplicate orderItemIds — so PayTR would charge
    // the customer and then book ZERO payments (intent → FAILED, manual
    // refund). Apply payByItems' dedup semantics here so the intent never
    // mints a token for a payload settlement will reject.
    const seenItemIds = new Set<string>();
    for (const entry of dto.items) {
      if (seenItemIds.has(entry.orderItemId)) {
        throw new BadRequestException(
          `Duplicate orderItemId ${entry.orderItemId} — combine the units into a single entry`,
        );
      }
      seenItemIds.add(entry.orderItemId);
    }

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
        const reasonSuffix =
          reserved > 0
            ? ` (${reserved} reserved by another in-flight payment)`
            : "";
        throw new BadRequestException(
          `Item ${entry.orderItemId} has ${remaining} units remaining, cannot pay ${entry.quantity}${reasonSuffix}`,
        );
      }

      // deep-review M12 — round each line to 2dp BEFORE summing
      // (round-then-sum) so the charged amount matches what payByItems
      // books per entry (it rounds each entry's amount toDecimalPlaces(2)
      // — payments.service.ts:1289). Pre-fix this summed full-precision
      // perUnit×qty and rounded once at the end, which for qty>1 /
      // discounted lines could diverge from the per-entry-rounded booked
      // total by a few kuruş, leaving PayTR payouts and KDS accounting
      // out of sync (and occasionally an order a kuruş short of PAID).
      // The webhook's reconciliation alert (sumBookedPayments vs amount)
      // surfaces any residual divergence on the last-units residual path
      // that this round-then-sum still can't fully predict.
      const perUnit = this.paymentsService.derivePerUnitNet(item, item.order);
      const lineAmount = perUnit.mul(entry.quantity).toDecimalPlaces(2);
      totalAmount = totalAmount.add(lineAmount);

      const bucket = itemsByOrder.get(item.orderId) ?? {
        orderId: item.orderId,
        items: [],
      };
      bucket.items.push({
        orderItemId: entry.orderItemId,
        quantity: entry.quantity,
      });
      itemsByOrder.set(item.orderId, bucket);
    }
    totalAmount = totalAmount.toDecimalPlaces(2);

    if (totalAmount.lte(0)) {
      throw new BadRequestException("Nothing to pay");
    }

    const merchantOid = generateMerchantOid(session.tenantId);
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
    const reqHash = createHash("sha256")
      .update(sessionId)
      .update("|")
      .update(
        JSON.stringify(
          Array.from(itemsByOrder.values()).sort((a, b) =>
            a.orderId.localeCompare(b.orderId),
          ),
        ),
      )
      .update("|")
      .update(totalAmount.toString())
      .update("|")
      .update(dto.customerPhone ?? "")
      .digest("hex")
      .slice(0, 32);
    const dedupExisting = await this.prisma.pendingSelfPayment.findFirst({
      where: {
        sessionId,
        tenantId: session.tenantId,
        status: "PENDING",
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
        "A payment for these items is already in progress — complete it in the open tab, or wait 15 minutes for it to expire.",
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
      // v3.0.0 — assert all touched orders share a branchId before
      // we mint the PendingSelfPayment row. Cross-branch intents are
      // a UX bug that should never reach the DB FK Restrict; this
      // catches it with a clearer error first.
      const distinctBranches = Array.from(
        new Set(guardedOrders.map((o) => o.branchId)),
      );
      if (distinctBranches.length !== 1) {
        throw new BadRequestException(
          "Self-pay intent spans multiple branches — split into separate intents.",
        );
      }
      const intentBranchId = distinctBranches[0];

      return tx.pendingSelfPayment.create({
        data: {
          merchantOid,
          sessionId,
          tenantId: session.tenantId,
          branchId: intentBranchId,
          itemsByOrder: Array.from(itemsByOrder.values()) as any,
          amount: totalAmount,
          status: "PENDING",
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
        truncateUtf8((item.product as any)?.name ?? "Ürün", 80) || "Ürün",
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
      const safePhone = "05000000000";

      const result = await this.paytrAdapter.getIframeToken({
        merchantOid,
        amount: totalAmount,
        // Validated above to be 'TRY'. Passed explicitly so the
        // adapter's currency-gate fires as defence in depth.
        currency: orderCurrency,
        email: safeEmail,
        userName: "Müşteri",
        userAddress: "Masa",
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
          status: "FAILED",
          failureReason: "paytr_token_error",
        },
      });
      throw err;
    }
  }
}
