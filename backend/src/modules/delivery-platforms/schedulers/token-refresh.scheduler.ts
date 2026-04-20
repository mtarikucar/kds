import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { DeliveryAuthService } from '../services/delivery-auth.service';

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
      const [{ locked }] = await this.prisma.$queryRawUnsafe<
        { locked: boolean }[]
      >(`SELECT pg_try_advisory_lock(${this.lockId('token-refresh')}) AS locked`);
      if (!locked) return;
      try {
        const count = await this.authService.refreshExpiringTokens();
        if (count > 0) {
          this.logger.log(`Refreshed ${count} expiring tokens`);
        }
      } catch (error: any) {
        this.logger.error(`Token refresh scheduler error: ${error.message}`);
      } finally {
        await this.prisma.$queryRawUnsafe(
          `SELECT pg_advisory_unlock(${this.lockId('token-refresh')})`,
        );
      }
    } finally {
      this.isRunning = false;
    }
  }

  private lockId(name: string): number {
    let hash = 5381;
    for (let i = 0; i < name.length; i += 1) {
      hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
    }
    return hash;
  }
}
