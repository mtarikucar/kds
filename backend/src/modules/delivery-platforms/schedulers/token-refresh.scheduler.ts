import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PrismaService } from "../../../prisma/prisma.service";
import { DeliveryAuthService } from "../services/delivery-auth.service";
import { withAdvisoryLock } from "../../../common/scheduling/advisory-lock";

@Injectable()
export class TokenRefreshScheduler {
  private readonly logger = new Logger(TokenRefreshScheduler.name);
  private isRunning = false;

  constructor(
    private prisma: PrismaService,
    private authService: DeliveryAuthService,
  ) {}

  @Interval(300_000)
  async refreshTokens() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      await withAdvisoryLock(
        this.prisma,
        "token-refresh",
        async () => {
          try {
            const count = await this.authService.refreshExpiringTokens();
            if (count > 0) {
              this.logger.log(`Refreshed ${count} expiring tokens`);
            }
          } catch (error: any) {
            this.logger.error(
              `Token refresh scheduler error: ${error.message}`,
            );
          }
        },
        this.logger,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
