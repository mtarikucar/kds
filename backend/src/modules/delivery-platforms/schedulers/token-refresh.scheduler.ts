import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DeliveryAuthService } from '../services/delivery-auth.service';

@Injectable()
export class TokenRefreshScheduler {
  private readonly logger = new Logger(TokenRefreshScheduler.name);

  constructor(private authService: DeliveryAuthService) {}

  @Interval(300_000) // Every 5 minutes
  async refreshTokens() {
    try {
      const count = await this.authService.refreshExpiringTokens();
      if (count > 0) {
        this.logger.log(`Refreshed ${count} expiring tokens`);
      }
    } catch (error: any) {
      this.logger.error(`Token refresh scheduler error: ${error.message}`);
    }
  }
}
