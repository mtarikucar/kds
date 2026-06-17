import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from "@nestjs/common";
import * as Sentry from "@sentry/node";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { PaymentsService } from "../../orders/services/payments.service";
import { PaymentStatus } from "../../../common/constants/order-status.enum";

interface ItemsByOrderShape {
  orderId: string;
  items: Array<{ orderItemId: string; quantity: number }>;
}

/**
 * Webhook settlement side of customer self-pay. Called by
 * PaytrWebhookController when the merchantOid prefix is "SP". Settles
 * every order in the intent's itemsByOrder snapshot via the regular
 * payByItems path (with the merchantOid acting as the idempotency key,
 * so a PayTR retry never double-charges). Extracted verbatim — the
 * pre-validate loop and the TOCTOU compound-WHERE-on-PENDING writes are
 * byte-for-byte the original.
 */
@Injectable()
export class SelfPayWebhookService {
  private readonly logger = new Logger(SelfPayWebhookService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => PaymentsService))
    private paymentsService: PaymentsService,
  ) {}

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
    // deep-review H10 — PARTIALLY_SETTLED must re-enter the loop on a
    // PayTR retry so the remaining (unbooked) buckets get a chance to
    // settle. payByItems' idempotency fast-path turns already-booked
    // buckets into no-ops, so a retry only books what's still missing
    // and eventually reaches SUCCEEDED. Terminal states (SUCCEEDED /
    // FAILED) still short-circuit.
    if (intent.status !== "PENDING" && intent.status !== "PARTIALLY_SETTLED") {
      // Idempotent — PayTR retried; we already settled (or gave up).
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
      // deep-review M16 — pre-validate every order's remaining quantities
      // under a FOR UPDATE lock on each referenced order, taken in sorted
      // orderId order to mirror self-pay-intent.service.ts (avoids
      // deadlocks against the create-time lock). Pre-fix the pre-validate
      // read ran completely unlocked, so a waiter taking cash (payByItems
      // / create) for the same units between this pass and the settle
      // pass would only be caught inside each individual payByItems
      // re-check — i.e. after earlier buckets already committed. Locking
      // here makes a concurrent POS payment either lose the race cleanly
      // (its own acquireOrderLock blocks until we release) or be visible
      // to us before we book anything. NOTE: this lock is released when
      // the pre-validate tx commits; the per-bucket payByItems calls
      // below each open their own tx. True single-transaction atomicity
      // across all buckets is deferred (it requires threading an injected
      // tx client through payByItems) — the recoverable-retry handling in
      // the catch below (H10) covers the residual partial-commit window.
      const lockOrderIds = [...itemsByOrder.map((b) => b.orderId)].sort();
      await this.prisma.$transaction(async (tx) => {
        for (const oid of lockOrderIds) {
          await tx.$queryRaw`
            SELECT id FROM orders WHERE id = ${oid} AND "tenantId" = ${intent.tenantId} FOR UPDATE
          `;
        }
        for (const bucket of itemsByOrder) {
          const items = await tx.orderItem.findMany({
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
      });

      for (const bucket of itemsByOrder) {
        await this.paymentsService.payByItems(
          bucket.orderId,
          {
            items: bucket.items,
            method: "CARD" as any,
            transactionId: merchantOid,
            customerPhone: intent.customerPhone || undefined,
            // Per-order idempotency key — PayTR retry returns the same
            // Payment instead of duplicating. Suffix with orderId so a
            // multi-order intent doesn't collide.
            idempotencyKey: `selfpay:${merchantOid}:${bucket.orderId}`,
            notes: paytrPaymentType
              ? `Self-pay via PayTR (${paytrPaymentType})`
              : "Self-pay via PayTR",
          },
          intent.tenantId,
        );
      }
      // deep-review M12 — defensive reconciliation: assert the sum of
      // booked Payment rows for this merchantOid equals the amount PayTR
      // actually charged (intent.amount). The per-entry allocation in
      // payByItems rounds differently than the intent's round-then-charge
      // path, so a few-kuruş divergence is possible for qty>1 / discounted
      // lines. We still flip to SUCCEEDED (the order-level finalizer is
      // authoritative for PAID), but alert so any residual drift between
      // PayTR payouts and KDS accounting is surfaced rather than silently
      // corrupting revenue.
      const bookedOnSuccess = await this.sumBookedPayments(
        merchantOid,
        intent.tenantId,
      );
      const intentAmount = new Prisma.Decimal(intent.amount);
      if (!bookedOnSuccess.equals(intentAmount)) {
        Sentry.captureMessage("SELF_PAY_AMOUNT_DRIFT", {
          level: "warning",
          tags: {
            event: "SELF_PAY_AMOUNT_DRIFT",
            tenantId: intent.tenantId,
          },
          extra: {
            merchantOid,
            charged: intentAmount.toFixed(2),
            booked: bookedOnSuccess.toFixed(2),
          },
        });
      }

      // Compound WHERE on the original PENDING status closes the
      // TOCTOU between the intent.status check above and this write.
      // A concurrent retry from PayTR that already finished settlement
      // won't be overwritten; a concurrent failure path won't be
      // downgraded to SUCCEEDED. A PARTIALLY_SETTLED row (deep-review
      // H10) that reached this point on a retry is also promoted.
      await this.prisma.pendingSelfPayment.updateMany({
        where: {
          id: intent.id,
          status: { in: ["PENDING", "PARTIALLY_SETTLED"] },
        },
        data: { status: "SUCCEEDED", succeededAt: new Date() },
      });
    } catch (err: any) {
      this.logger.error(
        `self-pay settlement failed for ${merchantOid}: ${err?.message ?? err}`,
        err?.stack,
      );

      // deep-review H10 — distinguish "nothing booked" from "some buckets
      // already committed" so a transient failure on bucket #N (e.g. a
      // waiter took cash for one unit between pre-validate and settle, or
      // a transient DB error) does not become a sticky-FAILED partial
      // charge. PayTR has already charged the full intent.amount; if we
      // flip to FAILED while bucket #1's Payment is durable, the PayTR
      // retry early-returns and the remaining orders are NEVER settled.
      // Instead: sum the committed Payments for this merchantOid.
      //   - NOTHING booked  -> safe to flip FAILED (ops refunds in full).
      //   - SOME booked      -> leave PARTIALLY_SETTLED so the next PayTR
      //     retry re-enters the loop; payByItems' idempotency fast-path
      //     makes booked buckets no-ops and only the remaining buckets
      //     get booked, eventually reaching SUCCEEDED (self-healing).
      let bookedOnFailure: Prisma.Decimal;
      try {
        bookedOnFailure = await this.sumBookedPayments(
          merchantOid,
          intent.tenantId,
        );
      } catch {
        // If we can't even read the booked sum, fall back to the
        // conservative legacy behaviour (treat as nothing booked).
        bookedOnFailure = new Prisma.Decimal(0);
      }
      const someBooked = bookedOnFailure.gt(0);

      if (someBooked) {
        // Dedicated reconciliation alert distinct from the full-failure
        // one, carrying how much settled vs. how much was charged so ops
        // sees partial states even if PayTR retries eventually heal them.
        Sentry.captureException(err, {
          level: "warning",
          tags: {
            event: "SELF_PAY_PARTIAL_SETTLEMENT",
            tenantId: intent.tenantId,
          },
          extra: {
            merchantOid,
            sessionId: intent.sessionId,
            charged: new Prisma.Decimal(intent.amount).toFixed(2),
            booked: bookedOnFailure.toFixed(2),
            raw: err?.message,
          },
        });
        // Leave recoverable: a PayTR retry resumes from PARTIALLY_SETTLED.
        // NOTE: an explicit retry upper-bound (attemptCount column → escalate
        // to FAILED-with-partial after N attempts) is deferred — it needs a
        // schema migration outside this change set; the alert above already
        // gives ops the signal to intervene if retries never heal it.
        await this.prisma.pendingSelfPayment.updateMany({
          where: {
            id: intent.id,
            status: { in: ["PENDING", "PARTIALLY_SETTLED"] },
          },
          data: {
            status: "PARTIALLY_SETTLED",
            failureReason: "partial_settlement",
          },
        });
        return;
      }

      Sentry.captureException(err, {
        tags: {
          event: "SELF_PAY_SETTLEMENT_FAILED",
          tenantId: intent.tenantId,
        },
        extra: { merchantOid, sessionId: intent.sessionId, raw: err?.message },
      });
      // Coded failureReason → frontend maps to localized message.
      // PayTR charged the card but our settlement didn't book ANY
      // Payment row; this is the path that needs ops attention
      // (manual refund). The Sentry alert carries the raw error; the
      // customer sees a friendly string. Compound WHERE on PENDING: a
      // concurrent retry that already succeeded must not be downgraded
      // to FAILED.
      await this.prisma.pendingSelfPayment.updateMany({
        where: { id: intent.id, status: "PENDING" },
        data: {
          status: "FAILED",
          failureReason: "settlement_error",
        },
      });
    }
  }

  /**
   * deep-review H10/M12 — sum the COMPLETED Payment rows booked for a
   * self-pay intent. payByItems books each bucket with
   * transactionId=merchantOid and idempotencyKey=selfpay:<oid>:<orderId>,
   * so transactionId is the stable join back to the intent. Used both to
   * decide partial-vs-total failure and to reconcile the booked total
   * against the amount PayTR actually charged.
   */
  private async sumBookedPayments(
    merchantOid: string,
    tenantId: string,
  ): Promise<Prisma.Decimal> {
    const agg = await this.prisma.payment.aggregate({
      where: {
        tenantId,
        transactionId: merchantOid,
        status: PaymentStatus.COMPLETED,
      },
      _sum: { amount: true },
    });
    return new Prisma.Decimal(agg._sum.amount ?? 0);
  }

  async handleWebhookFailure(
    merchantOid: string,
    reason: string | undefined,
  ): Promise<void> {
    await this.prisma.pendingSelfPayment.updateMany({
      where: { merchantOid, status: "PENDING" },
      data: {
        status: "FAILED",
        failureReason: reason ?? "paytr_reported_failure",
      },
    });
  }
}
