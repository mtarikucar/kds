import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as Sentry from "@sentry/node";
import { addHours } from "date-fns";
import { withAdvisoryLock } from "../../../common/scheduling/advisory-lock";
import { PrismaService } from "../../../prisma/prisma.service";
import { PaytrAdapter } from "../../payments/adapters/paytr.adapter";
import { SelfPayWebhookService } from "./self-pay-webhook.service";

/**
 * Inquiry-recovery cron for customer self-pay (QR-menu PayTR) intents —
 * the missing parity with the subscription rail's
 * `handlePaytrPendingRecovery` (subscription-scheduler.service.ts).
 *
 * THE BUG THIS CLOSES (sweep-3 finding #4): a diner completes a QR
 * self-pay, PayTR charges the card and shows "success", but the success
 * webhook is lost/late (endpoint downtime, IP-allowlist drop, PayTR retry
 * latency) OR lands a hair after the intent's 15-min TTL. Three code
 * paths flip a PENDING intent to terminal EXPIRED purely on wall-clock
 * time with NO PayTR check (getPayStatus lazy-expire, SelfPaySweeperService,
 * self-pay-orphan-cleanup). The genuine success callback then arrives and
 * is dropped. The card was charged but the order is never settled, never
 * refunded, and never alerted.
 *
 * Recovery (mirrors the subscription rail exactly):
 *   - Hourly, advisory-locked (one replica per tick).
 *   - Find PendingSelfPayment rows that are recoverable-terminal
 *     (EXPIRED, or PENDING that's overdue) within a 48h grace window,
 *     plus any FAILED rows whose failureReason is a wall-clock/transient
 *     one (NOT a deliberate settlement_error refund-needed state).
 *   - Ask PayTR `inquiryStatus(merchantOid)` what really happened.
 *   - On status === "success", replay handleWebhookSuccess, which now
 *     re-opens the terminal row and settles via the idempotent payByItems
 *     path (selfpay:<oid>:<orderId>) — a real paid intent settles exactly
 *     once even if the late webhook ALSO lands.
 *   - On status === "failed", mark the intent FAILED (genuine abandonment).
 *   - On "pending"/"unknown", leave it for the next hour.
 *   - Hard cap 50 rows/run to bound PayTR API spend, ordered oldest-first.
 *
 * Per-row isolation: a single throw must not abort the batch (a poison row
 * ordered first would otherwise permanently block recovery of newer rows).
 *
 * GAP NOTE: PayTR's inquiry response does not carry the full charged
 * breakdown we'd need to reconcile per-bucket amounts here; we rely on the
 * intent's own itemsByOrder snapshot (immutable, captured at create-time)
 * which is exactly what the webhook path replays. The booked-vs-charged
 * drift alert (SELF_PAY_AMOUNT_DRIFT) inside handleWebhookSuccess still
 * fires on the replay, so any divergence is surfaced.
 */
@Injectable()
export class SelfPayRecoveryService {
  private readonly logger = new Logger(SelfPayRecoveryService.name);

  // Wall-clock failure reasons that DON'T mean "we know the card wasn't
  // charged" — they were set by a TTL sweeper or a lazy expire, so the row
  // is a recovery candidate. A FAILED row written by the settlement-error
  // path (failureReason "settlement_error") is deliberately EXCLUDED: there
  // the money WAS charged but our booking threw, which is an ops-refund
  // case the webhook H10 healing already owns — re-inquiring wouldn't change
  // the outcome and could mask the alert.
  private static readonly RECOVERABLE_FAILURE_REASONS = [
    "expired",
    "TTL expired (sweeper)",
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly paytr: PaytrAdapter,
    private readonly webhook: SelfPayWebhookService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: "self-pay-inquiry-recovery" })
  async recoverStuckIntents(): Promise<void> {
    await withAdvisoryLock(
      this.prisma,
      "self-pay-inquiry-recovery",
      async () => {
        const now = new Date();
        // 48h grace window — long enough to catch fully-lost callbacks and
        // PayTR retry exhaustion, bounded so we never re-inquire ancient
        // rows that are long past any dispute window.
        const graceFloor = addHours(now, -48);

        const candidates = await this.prisma.pendingSelfPayment.findMany({
          where: {
            createdAt: { gte: graceFloor },
            merchantOid: { startsWith: "SP" },
            OR: [
              // A late/lost callback on an expired intent.
              {
                status: "EXPIRED",
                failureReason: {
                  in: SelfPayRecoveryService.RECOVERABLE_FAILURE_REASONS,
                },
              },
              // A still-PENDING intent that's past TTL but no sweeper has
              // touched yet (or a fully-lost callback never polled).
              {
                status: "PENDING",
                expiresAt: { lt: now },
              },
              // A FAILED row whose reason is a wall-clock one (defensive:
              // covers a future code path that fails-on-expire).
              {
                status: "FAILED",
                failureReason: {
                  in: SelfPayRecoveryService.RECOVERABLE_FAILURE_REASONS,
                },
              },
            ],
          },
          select: { id: true, merchantOid: true, tenantId: true },
          orderBy: { createdAt: "asc" },
          take: 50,
        });

        if (candidates.length === 0) return;

        let recovered = 0;
        let confirmedFailed = 0;
        let stillPending = 0;
        let errored = 0;

        for (const row of candidates) {
          const oid = row.merchantOid;
          try {
            const inquiry = await this.paytr.inquiryStatus(oid);
            if (inquiry.status === "success") {
              // Replay settlement. handleWebhookSuccess re-opens the
              // terminal row and settles idempotently; it emits
              // SELF_PAY_RECOVERED_ON_WEBHOOK and reconciliation alerts
              // itself, and never throws. We add a recovery-cron alert so
              // ops sees the near-miss was caught by the sweeper (not a
              // callback).
              await this.webhook.handleWebhookSuccess(oid, inquiry.paymentType);
              Sentry.captureMessage("SELF_PAY_INQUIRY_PAID_BUT_EXPIRED", {
                level: "warning",
                tags: {
                  event: "SELF_PAY_INQUIRY_PAID_BUT_EXPIRED",
                  tenantId: row.tenantId,
                },
                extra: { merchantOid: oid },
              });
              recovered += 1;
            } else if (inquiry.status === "failed") {
              // PayTR confirms the card was NOT charged — genuine
              // abandonment. Pin to FAILED so we stop re-inquiring it.
              // Only touch rows we'd actually consider recoverable
              // (compound WHERE), so we never downgrade a row another
              // path settled in the meantime.
              await this.prisma.pendingSelfPayment.updateMany({
                where: {
                  id: row.id,
                  status: { in: ["PENDING", "EXPIRED"] },
                },
                data: {
                  status: "FAILED",
                  failureReason: "inquiry_confirmed_unpaid",
                },
              });
              confirmedFailed += 1;
            } else {
              // "pending" / "unknown" — leave it for next hour.
              stillPending += 1;
            }
          } catch (err) {
            errored += 1;
            this.logger.error(
              `self-pay inquiry recovery failed for oid=${oid}: ${
                (err as Error).message
              }`,
            );
            continue;
          }
        }

        this.logger.log(
          `self-pay inquiry recovery: scanned=${candidates.length} ` +
            `recovered=${recovered} confirmedFailed=${confirmedFailed} ` +
            `stillPending=${stillPending} errored=${errored}`,
        );
      },
      this.logger,
    );
  }
}
