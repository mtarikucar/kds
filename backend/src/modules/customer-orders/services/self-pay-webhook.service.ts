import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from "@nestjs/common";
import * as Sentry from "@sentry/node";
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
    if (intent.status !== "PENDING") {
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
      // Compound WHERE on the original PENDING status closes the
      // TOCTOU between line 704's intent.status check and this write.
      // A concurrent retry from PayTR that already finished settlement
      // won't be overwritten; a concurrent failure path won't be
      // downgraded to SUCCEEDED.
      await this.prisma.pendingSelfPayment.updateMany({
        where: { id: intent.id, status: "PENDING" },
        data: { status: "SUCCEEDED", succeededAt: new Date() },
      });
    } catch (err: any) {
      this.logger.error(
        `self-pay settlement failed for ${merchantOid}: ${err?.message ?? err}`,
        err?.stack,
      );
      Sentry.captureException(err, {
        tags: {
          event: "SELF_PAY_SETTLEMENT_FAILED",
          tenantId: intent.tenantId,
        },
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
        where: { id: intent.id, status: "PENDING" },
        data: {
          status: "FAILED",
          failureReason: "settlement_error",
        },
      });
    }
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
