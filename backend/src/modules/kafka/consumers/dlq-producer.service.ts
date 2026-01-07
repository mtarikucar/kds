import { Injectable, Logger } from '@nestjs/common';
import { KafkaService } from '../kafka.service';
import {
  KafkaTopics,
  KafkaTopic,
  KafkaMessageEnvelope,
  DLQEvent,
} from '../interfaces/kafka-event.interface';

@Injectable()
export class DLQProducerService {
  private readonly logger = new Logger(DLQProducerService.name);

  constructor(private readonly kafkaService: KafkaService) {}

  /**
   * Send a failed message to the appropriate DLQ topic
   */
  async sendToDLQ<T>(
    sourceTopic: KafkaTopic | string,
    originalEvent: KafkaMessageEnvelope<T>,
    error: Error,
  ): Promise<void> {
    const dlqTopic = this.getDLQTopic(sourceTopic);

    const dlqEvent: DLQEvent<T> = {
      originalEvent,
      error: {
        message: error.message,
        code: (error as any).code,
        stack: error.stack,
      },
      failedAt: new Date(),
      sourceTopic,
    };

    const key = this.generateDLQKey(originalEvent);

    this.logger.warn(`Sending message to DLQ: ${dlqTopic}`, {
      correlationId: originalEvent.correlationId,
      sourceTopic,
      errorMessage: error.message,
    });

    try {
      await this.kafkaService.produce(dlqTopic as KafkaTopic, dlqEvent, {
        key,
        headers: {
          tenantId: originalEvent.metadata.tenantId,
          correlationId: originalEvent.correlationId,
          sourceTopic,
          errorMessage: error.message.substring(0, 200), // Truncate for header
          failedAt: new Date().toISOString(),
        },
      });

      this.logger.log(`Message sent to DLQ successfully: ${dlqTopic}`, {
        correlationId: originalEvent.correlationId,
      });
    } catch (dlqError) {
      this.logger.error(`Failed to send message to DLQ: ${dlqTopic}`, {
        error: dlqError.message,
        correlationId: originalEvent.correlationId,
      });
      // Don't throw - we don't want to lose the original error context
    }
  }

  /**
   * Get the DLQ topic for a given source topic
   */
  private getDLQTopic(sourceTopic: string): string {
    const dlqMapping: Record<string, string> = {
      [KafkaTopics.PLATFORM_WEBHOOKS]: KafkaTopics.PLATFORM_WEBHOOKS_DLQ,
      [KafkaTopics.ORDER_STATUS_SYNC]: KafkaTopics.ORDER_STATUS_SYNC_DLQ,
    };

    return dlqMapping[sourceTopic] || `${sourceTopic}-dlq`;
  }

  /**
   * Generate a key for DLQ messages
   */
  private generateDLQKey<T>(event: KafkaMessageEnvelope<T>): string {
    const payload = event.payload as any;
    const parts = [
      event.metadata.tenantId,
      payload.platformType || 'unknown',
      payload.platformOrderId || event.eventId,
    ];
    return parts.join(':');
  }
}
