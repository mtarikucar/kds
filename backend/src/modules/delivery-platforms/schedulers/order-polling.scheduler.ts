import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { AdapterFactory } from '../adapters/adapter-factory';
import { DeliveryOrderService } from '../services/delivery-order.service';
import { DeliveryAuthService } from '../services/delivery-auth.service';
import { DeliveryConfigService } from '../services/delivery-config.service';
import { DeliveryLogService } from '../services/delivery-log.service';
import {
  POLLING_PLATFORMS,
  PLATFORM_POLL_INTERVALS,
  CIRCUIT_BREAKER_THRESHOLD,
} from '../constants/platform-status-map';
import { PlatformLogDirection, PlatformLogAction } from '../constants/platform.enum';

/** Maximum number of tenants to poll in parallel per tick. */
const CONCURRENCY = 10;

@Injectable()
export class OrderPollingScheduler {
  private readonly logger = new Logger(OrderPollingScheduler.name);
  // Nest `@Interval` schedules the next tick N ms after the previous
  // fired (not after it completed). If a tick overruns, the next one
  // would run concurrently and race against itself — this flag skips it.
  private isRunning = false;

  constructor(
    private prisma: PrismaService,
    private adapterFactory: AdapterFactory,
    private orderService: DeliveryOrderService,
    private authService: DeliveryAuthService,
    private configService: DeliveryConfigService,
    private logService: DeliveryLogService,
  ) {}

  @Interval(15_000)
  async pollOrders() {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    try {
      // Advisory lock across replicas so horizontal scaling doesn't
      // double-poll the platforms (and double-bill our API quotas).
      const [{ locked }] = await this.prisma.$queryRawUnsafe<{ locked: boolean }[]>(
        `SELECT pg_try_advisory_lock(${this.lockId('order-polling')}) AS locked`,
      );
      if (!locked) return;

      try {
        await this.runOnce();
      } finally {
        await this.prisma.$queryRawUnsafe(
          `SELECT pg_advisory_unlock(${this.lockId('order-polling')})`,
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

  private async runOnce() {
    const configs = await this.prisma.deliveryPlatformConfig.findMany({
      where: {
        isEnabled: true,
        deletedAt: null,
        platform: { in: [...POLLING_PLATFORMS] },
        errorCount: { lt: CIRCUIT_BREAKER_THRESHOLD },
      },
    });

    // Respect per-platform cadence and poll the remaining configs with
    // bounded concurrency.
    const eligible = configs.filter((config) => {
      const minInterval = PLATFORM_POLL_INTERVALS[config.platform] || 15_000;
      return (
        !config.lastOrderPollAt ||
        Date.now() - config.lastOrderPollAt.getTime() >= minInterval
      );
    });

    for (let i = 0; i < eligible.length; i += CONCURRENCY) {
      const batch = eligible.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map((c) => this.pollPlatform(c)));
    }
  }

  private async pollPlatform(config: any) {
    const adapter = this.adapterFactory.getAdapter(config.platform);
    if (!adapter.pollNewOrders) return;

    try {
      const freshConfig = await this.authService.ensureValidToken(config.id);
      if (!freshConfig) return;

      const orders = await adapter.pollNewOrders(freshConfig);

      await this.configService.updateLastPollTime(config.id);
      if (config.errorCount > 0) {
        await this.configService.resetErrorCount(config.id);
      }

      for (const normalizedOrder of orders) {
        try {
          await this.orderService.processIncomingOrder(
            config.tenantId,
            normalizedOrder,
          );
        } catch (error: any) {
          this.logger.error(
            `Failed to process ${config.platform} order ${normalizedOrder.externalOrderId}: ${error.message}`,
          );
          await this.logService.log({
            tenantId: config.tenantId,
            platform: config.platform,
            direction: PlatformLogDirection.INBOUND,
            action: PlatformLogAction.ORDER_RECEIVED,
            externalId: normalizedOrder.externalOrderId,
            request: this.logService.scrubPii(normalizedOrder.rawPayload),
            success: false,
            error: error.message,
            nextRetryAt: new Date(Date.now() + 30_000),
          });
        }
      }

      if (orders.length > 0) {
        this.logger.log(
          `Polled ${orders.length} new orders from ${config.platform} (tenant: ${config.tenantId})`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Poll failed for ${config.platform} (tenant: ${config.tenantId}): ${error.message}`,
      );

      await this.configService.recordError(config.id, error.message);

      await this.logService.log({
        tenantId: config.tenantId,
        platform: config.platform,
        direction: PlatformLogDirection.INBOUND,
        action: PlatformLogAction.ORDER_POLL,
        success: false,
        error: error.message,
        statusCode: error.response?.status,
      });
    }
  }
}
