import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { withAdvisoryLock } from "../../common/scheduling/advisory-lock";
import { OutboxService } from "../outbox/outbox.service";
import { EventTypes } from "../outbox/event-types";
import { captureSwallowedEmit } from "../../common/observability/capture-swallowed-emit";

/**
 * Nightly sweeper that closes out tenant add-ons whose billing window has
 * elapsed.
 *
 * For each row past `currentPeriodEnd`:
 *   - If `cancelAtPeriodEnd` is true: flip status='cancelled', endedAt=now,
 *     emit `AddOnCancelled` so the entitlement projector revokes the grant.
 *   - Otherwise: roll the period forward by 30d. (Real billing-cycle
 *     alignment lands when Subscription periods drive these directly.)
 *
 * Runs at 03:00 UTC, just before the entitlement nightly reconcile (03:15)
 * so cancellation revocations are reflected by the time the reconcile fires.
 */
@Injectable()
export class TenantAddOnSweeperService {
  private readonly logger = new Logger(TenantAddOnSweeperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
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

    const expired = await this.prisma.tenantAddOn.findMany({
      where: {
        status: "active",
        currentPeriodEnd: { lte: now, not: null },
      },
      select: {
        id: true,
        tenantId: true,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: true,
        addOn: { select: { code: true, billing: true } },
      },
    });
    if (expired.length === 0) {
      this.logger.debug("No tenant add-ons past period end");
      return;
    }

    let closed = 0;
    let rolled = 0;
    for (const row of expired) {
      try {
        if (row.cancelAtPeriodEnd || row.addOn.billing === "oneTime") {
          await this.prisma.tenantAddOn.update({
            where: { id: row.id },
            data: { status: "cancelled", endedAt: now },
          });
          await this.outbox
            .append({
              type: EventTypes.AddOnCancelled,
              tenantId: row.tenantId,
              payload: {
                tenantId: row.tenantId,
                addOnId: row.id,
                addOnCode: row.addOn.code,
              },
            })
            .catch(
              captureSwallowedEmit(this.logger, {
                module: "marketplace",
                op: "addonSweeper",
              }),
            );
          closed++;
        } else {
          // Roll period forward 30 days. Real cycle alignment comes when
          // subscription/billing service drives this.
          const start = row.currentPeriodEnd ?? now;
          const end = new Date(start.getTime() + 30 * 24 * 3600 * 1000);
          await this.prisma.tenantAddOn.update({
            where: { id: row.id },
            data: { currentPeriodStart: start, currentPeriodEnd: end },
          });
          rolled++;
        }
      } catch (e) {
        this.logger.warn(
          `sweep failed for tenantAddOn=${row.id}: ${(e as Error).message}`,
        );
      }
    }
    this.logger.log(
      `tenant-addon sweep: scanned=${expired.length} closed=${closed} rolled=${rolled}`,
    );
  }
}
