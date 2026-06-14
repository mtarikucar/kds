import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { withAdvisoryLock } from "../../../common/scheduling/advisory-lock";
import { PrismaService } from "../../../prisma/prisma.service";

/**
 * Periodic TTL sweeper for expired PENDING self-pay intents.
 *
 * v2.8.98 — pre-fix the expire path was lazy: getPayStatus flipped a
 * PENDING row to EXPIRED on the first poll AFTER expiresAt; if nobody
 * polled (customer abandoned the tab) the row sat as PENDING forever,
 * keeping the dedup index matching ghost rows and forcing the webhook
 * handler to assume a late callback was still in flight.
 *
 * The cron sweeps under an advisory lock so only one replica runs at a
 * time, transitioning PENDING+expiresAt<now to EXPIRED with a reason.
 * Rows aren't hard-deleted — the audit trail is useful for retention
 * metrics and disputed-charge investigations.
 */
@Injectable()
export class SelfPaySweeperService {
  private readonly logger = new Logger(SelfPaySweeperService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: "self-pay-intent-expire" })
  async expireStaleIntents(): Promise<void> {
    await withAdvisoryLock(
      this.prisma,
      "self-pay-intent-expire",
      async () => {
        const result = await this.prisma.pendingSelfPayment.updateMany({
          where: {
            status: "PENDING",
            expiresAt: { lt: new Date() },
          },
          data: {
            status: "EXPIRED",
            failureReason: "TTL expired (sweeper)",
          },
        });
        if (result.count > 0) {
          this.logger.log(
            `self-pay sweeper: transitioned ${result.count} PENDING intents to EXPIRED`,
          );
        }
      },
      this.logger,
    );
  }
}
