import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface IdempotencyRecord {
  processedAt: Date;
  correlationId: string;
  result?: string;
}

@Injectable()
export class IdempotencyService implements OnModuleDestroy {
  private redis: Redis;
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly KEY_PREFIX = 'kafka:idempotency:';
  private readonly DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error', error);
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis connected for idempotency service');
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  /**
   * Check if a message has already been processed
   * @param key Unique identifier for the message (e.g., tenantId:platformType:platformOrderId)
   */
  async isDuplicate(key: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(`${this.KEY_PREFIX}${key}`);
      return exists === 1;
    } catch (error) {
      this.logger.error(`Failed to check idempotency for key: ${key}`, error);
      // On error, assume not duplicate to avoid blocking legitimate messages
      return false;
    }
  }

  /**
   * Mark a message as processed
   * @param key Unique identifier for the message
   * @param metadata Additional metadata about the processing
   * @param ttlSeconds Optional TTL override (default: 24 hours)
   */
  async markProcessed(
    key: string,
    metadata: Partial<IdempotencyRecord>,
    ttlSeconds?: number,
  ): Promise<void> {
    try {
      const record: IdempotencyRecord = {
        processedAt: new Date(),
        correlationId: metadata.correlationId || 'unknown',
        result: metadata.result,
      };

      const ttl = ttlSeconds || this.DEFAULT_TTL_SECONDS;
      await this.redis.setex(
        `${this.KEY_PREFIX}${key}`,
        ttl,
        JSON.stringify(record),
      );

      this.logger.debug(`Marked message as processed: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to mark message as processed: ${key}`, error);
      // Don't throw - processing should continue even if idempotency tracking fails
    }
  }

  /**
   * Get the processing record for a key
   */
  async getRecord(key: string): Promise<IdempotencyRecord | null> {
    try {
      const data = await this.redis.get(`${this.KEY_PREFIX}${key}`);
      if (!data) {
        return null;
      }
      return JSON.parse(data) as IdempotencyRecord;
    } catch (error) {
      this.logger.error(`Failed to get idempotency record for key: ${key}`, error);
      return null;
    }
  }

  /**
   * Remove a processing record (useful for retry scenarios)
   */
  async removeRecord(key: string): Promise<void> {
    try {
      await this.redis.del(`${this.KEY_PREFIX}${key}`);
      this.logger.debug(`Removed idempotency record: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to remove idempotency record: ${key}`, error);
    }
  }

  /**
   * Generate a standard idempotency key for webhook events
   */
  generateWebhookKey(
    tenantId: string,
    platformType: string,
    platformOrderId: string,
    eventType?: string,
  ): string {
    const parts = [tenantId, platformType, platformOrderId];
    if (eventType) {
      parts.push(eventType);
    }
    return parts.join(':');
  }
}
