import { Injectable, Logger, Optional } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { withAdvisoryLock } from "../../common/scheduling/advisory-lock";
import { OutboxService } from "../outbox/outbox.service";
import { EventTypes } from "../outbox/event-types";
import { NotificationService } from "../subscriptions/services/notification.service";
import { ADDON_GRACE_DAYS } from "./marketplace.types";

/**
 * Nightly sweeper that drives the tenant add-on billing lifecycle.
 *
 * Manual-renewal model — PayTR's Kart Saklama / recurring authorisation is
 * closed for this merchant, so we never auto-charge. Recurring add-ons
 * therefore mirror the Subscription lifecycle exactly (ACTIVE → PAST_DUE →
 * EXPIRED), NOT the old "roll +30d for free" behaviour which kept a paid
 * capability (extra branch, KDS screen, fiscal integration, API access)
 * alive forever after a single charge.
 *
 * For each row at/after `currentPeriodEnd`:
 *   - `cancelAtPeriodEnd=true` OR one-time add-on → status='cancelled',
 *     endedAt=now, emit AddOnCancelled (projector revokes the grant).
 *   - recurring + not cancelled + status='active' → status='past_due'
 *     (NOT a free extension). The entitlement is KEPT live through a
 *     `ADDON_GRACE_DAYS` grace window (the projector still grants past_due
 *     rows). Emit AddOnPastDue + nudge the operator to re-pay through
 *     checkout. This is the bug fix: the period no longer rolls forward for
 *     free.
 *   - recurring + status='past_due' past the grace deadline (currentPeriodEnd
 *     + ADDON_GRACE_DAYS) → status='expired', endedAt=now, emit AddOnCancelled
 *     (projector revokes the grant). Reactivation is re-payment-only via the
 *     checkout → PayTR → confirmAndProvision rail (TenantMarketplaceService
 *     reactivates the row).
 *
 * Runs at 03:00 UTC, just before the entitlement nightly reconcile (03:15)
 * so revocations are reflected by the time the reconcile fires.
 */
@Injectable()
export class TenantAddOnSweeperService {
  private readonly logger = new Logger(TenantAddOnSweeperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    // Optional so the legacy tests that build the sweeper with just
    // (prisma, outbox) keep working; email is always best-effort anyway.
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  @Cron("0 3 * * *")
  async runDaily(): Promise<void> {
    await withAdvisoryLock(
      this.prisma,
      "marketplace.addonSweeper",
      () => this.runOnce(),
      this.logger,
    );
  }

  /** Inner body — extracted so tests can call it without the lock wrapper. */
  async runOnce(): Promise<void> {
    const now = new Date();

    // Two cohorts in one scan:
    //   active   → close-out (cancelled) or transition to past_due
    //   past_due → expire once the grace deadline has elapsed
    const due = await this.prisma.tenantAddOn.findMany({
      where: {
        status: { in: ["active", "past_due"] },
        currentPeriodEnd: { lte: now, not: null },
      },
      select: {
        id: true,
        tenantId: true,
        status: true,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: true,
        addOn: { select: { code: true, billing: true } },
      },
    });
    if (due.length === 0) {
      this.logger.debug("No tenant add-ons past period end");
      return;
    }

    let closed = 0;
    let pastDue = 0;
    let expired = 0;
    let waiting = 0;
    for (const row of due) {
      try {
        if (row.status === "past_due") {
          // Grace-expiry branch: only expire once currentPeriodEnd +
          // ADDON_GRACE_DAYS has elapsed. Until then the past_due row keeps
          // its (still-granted) entitlement — mirrors Subscription PAST_DUE.
          const graceEnd = this.graceDeadline(row.currentPeriodEnd!);
          if (now < graceEnd) {
            waiting++;
            continue;
          }
          // Expire-claim AND the revoke event in ONE transaction (tx-aware
          // append). AddOnCancelled is the event the projector listens for to
          // REVOKE the grant; a swallowed .catch() previously left an expired
          // add-on still GRANTED until the ~24h nightly reconcile (paid-for
          // capacity persisting after non-payment). If the enqueue fails the
          // expire-claim rolls back and the next sweep retries the row.
          // Compound WHERE on status='past_due' so a concurrent re-payment
          // (which flips the row back to 'active') makes this a no-op rather
          // than clobbering the freshly-renewed row to 'expired'.
          const expiredOk = await this.prisma.$transaction(async (tx) => {
            const claim = await tx.tenantAddOn.updateMany({
              where: { id: row.id, status: "past_due" },
              data: { status: "expired", endedAt: now },
            });
            if (claim.count === 0) return false;
            await this.outbox.append(
              {
                type: EventTypes.AddOnCancelled,
                tenantId: row.tenantId,
                payload: {
                  tenantId: row.tenantId,
                  addOnId: row.id,
                  addOnCode: row.addOn.code,
                },
              },
              tx,
            );
            return true;
          });
          if (!expiredOk) {
            waiting++;
            continue;
          }
          await this.notifyOperator(row.tenantId, row.addOn.code, "expired");
          expired++;
          continue;
        }

        // status === 'active' below.
        if (row.cancelAtPeriodEnd || row.addOn.billing === "oneTime") {
          // Close-out + revoke event atomically (tx-aware append): a swallowed
          // enqueue previously left a cancelled add-on still granted until the
          // nightly reconcile.
          await this.prisma.$transaction(async (tx) => {
            await tx.tenantAddOn.update({
              where: { id: row.id },
              data: { status: "cancelled", endedAt: now },
            });
            await this.outbox.append(
              {
                type: EventTypes.AddOnCancelled,
                tenantId: row.tenantId,
                payload: {
                  tenantId: row.tenantId,
                  addOnId: row.id,
                  addOnCode: row.addOn.code,
                },
              },
              tx,
            );
          });
          closed++;
        } else {
          // Recurring + not cancelled: the paid period ended and there is NO
          // card vault to auto-charge. Transition to past_due (DO NOT extend
          // for free — that was the defect). The entitlement is kept live
          // through the grace window; the operator must re-pay via checkout.
          // Compound WHERE on status='active' so this is a safe no-op if a
          // concurrent action already moved the row.
          const graceEnd = this.graceDeadline(row.currentPeriodEnd!);
          const pastDueOk = await this.prisma.$transaction(async (tx) => {
            const claim = await tx.tenantAddOn.updateMany({
              where: { id: row.id, status: "active" },
              data: { status: "past_due" },
            });
            if (claim.count === 0) return false;
            await this.outbox.append(
              {
                type: EventTypes.AddOnPastDue,
                tenantId: row.tenantId,
                payload: {
                  tenantId: row.tenantId,
                  addOnId: row.id,
                  addOnCode: row.addOn.code,
                  graceEndsAt: graceEnd.toISOString(),
                },
              },
              tx,
            );
            return true;
          });
          if (!pastDueOk) {
            waiting++;
            continue;
          }
          await this.notifyOperator(row.tenantId, row.addOn.code, "past_due");
          pastDue++;
        }
      } catch (e) {
        this.logger.warn(
          `sweep failed for tenantAddOn=${row.id}: ${(e as Error).message}`,
        );
      }
    }
    this.logger.log(
      `tenant-addon sweep: scanned=${due.length} closed=${closed} pastDue=${pastDue} expired=${expired} waiting=${waiting}`,
    );
  }

  private graceDeadline(periodEnd: Date): Date {
    return new Date(periodEnd.getTime() + ADDON_GRACE_DAYS * 24 * 3600 * 1000);
  }

  /**
   * Best-effort operator nudge so an add-on never silently stops. Never
   * throws and never blocks the sweep loop — the AddOnPastDue / AddOnCancelled
   * outbox event is the durable signal; the email is a courtesy.
   */
  private async notifyOperator(
    tenantId: string,
    addOnCode: string,
    stage: "past_due" | "expired",
  ): Promise<void> {
    if (!this.notifications) return;
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });
      const admin = await this.prisma.user.findFirst({
        where: { tenantId, role: "ADMIN" },
        select: { email: true },
      });
      if (!admin?.email) return;
      await this.notifications.sendAddOnPastDue(
        admin.email,
        tenant?.name ?? "",
        addOnCode,
        stage,
      );
    } catch (err) {
      this.logger.warn(
        `add-on ${stage} notification failed for tenant=${tenantId} addon=${addOnCode}: ${(err as Error).message}`,
      );
    }
  }
}
