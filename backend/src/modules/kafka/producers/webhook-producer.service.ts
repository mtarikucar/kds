import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { KafkaService } from '../kafka.service';
import {
  KafkaTopics,
  WebhookReceivedEvent,
  ProduceResult,
} from '../interfaces/kafka-event.interface';
import { PlatformType } from '../../order-integrations/constants';

export interface WebhookProduceParams {
  tenantId: string;
  platformType: PlatformType;
  platformOrderId: string;
  webhookType: 'ORDER_CREATED' | 'ORDER_CANCELLED' | 'ORDER_UPDATED' | 'STATUS_CHANGED';
  rawPayload: unknown;
  headers?: Record<string, string>;
  correlationId?: string;
}

@Injectable()
export class WebhookProducerService {
  private readonly logger = new Logger(WebhookProducerService.name);

  constructor(private readonly kafkaService: KafkaService) {}

  /**
   * Check if Kafka is enabled for webhook processing
   */
  isEnabled(): boolean {
    return this.kafkaService.isKafkaEnabled();
  }

  /**
   * Produce a webhook event to Kafka for async processing
   */
  async produce(params: WebhookProduceParams): Promise<ProduceResult | null> {
    const {
      tenantId,
      platformType,
      platformOrderId,
      webhookType,
      rawPayload,
      headers = {},
      correlationId = randomUUID(),
    } = params;

    // Generate a unique key for partitioning and idempotency
    const key = this.generateKey(tenantId, platformType, platformOrderId);

    const event: WebhookReceivedEvent = {
      platformType,
      platformOrderId,
      webhookType,
      rawPayload,
      headers,
      receivedAt: new Date(),
    };

    this.logger.log(
      `Producing webhook event: ${webhookType} for ${platformType}/${platformOrderId}`,
      { correlationId, tenantId },
    );

    try {
      const result = await this.kafkaService.produce(
        KafkaTopics.PLATFORM_WEBHOOKS,
        event,
        {
          key,
          headers: {
            tenantId,
            correlationId,
            platformType,
            webhookType,
          },
        },
      );

      if (result) {
        this.logger.debug(
          `Webhook event produced successfully: ${key}`,
          { partition: result.partition, offset: result.offset },
        );
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to produce webhook event: ${key}`,
        { error: error.message, correlationId },
      );
      throw error;
    }
  }

  /**
   * Produce a batch of webhook events
   */
  async produceBatch(events: WebhookProduceParams[]): Promise<(ProduceResult | null)[]> {
    const results: (ProduceResult | null)[] = [];

    for (const event of events) {
      try {
        const result = await this.produce(event);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to produce batch event`, { error: error.message });
        results.push(null);
      }
    }

    return results;
  }

  /**
   * Generate a consistent key for a webhook event
   * Used for partitioning and idempotency
   */
  generateKey(
    tenantId: string,
    platformType: PlatformType | string,
    platformOrderId: string,
  ): string {
    return `${tenantId}:${platformType}:${platformOrderId}`;
  }
}
