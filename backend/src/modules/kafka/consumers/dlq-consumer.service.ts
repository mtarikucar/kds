import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EachMessagePayload } from 'kafkajs';
import { PrismaService } from '../../../prisma/prisma.service';
import { KafkaService } from '../kafka.service';
import {
  KafkaTopics,
  KafkaConsumerGroups,
  KafkaMessageEnvelope,
  DLQEvent,
  WebhookReceivedEvent,
} from '../interfaces/kafka-event.interface';

@Injectable()
export class DLQConsumerService implements OnModuleInit {
  private readonly logger = new Logger(DLQConsumerService.name);

  // Exponential backoff intervals in milliseconds
  private readonly RETRY_DELAYS_MS = [
    60000,    // 1 minute
    300000,   // 5 minutes
    900000,   // 15 minutes
    1800000,  // 30 minutes
    3600000,  // 60 minutes
  ];

  private readonly MAX_RETRIES = 5;

  constructor(
    private readonly kafkaService: KafkaService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    const kafkaEnabled = this.configService.get<boolean>('kafka.enabled', false);
    const useKafkaDLQ = this.configService.get<boolean>('kafka.useKafkaDLQ', false);

    if (!kafkaEnabled || !useKafkaDLQ) {
      this.logger.warn('Kafka DLQ consumer is disabled.');
      return;
    }

    try {
      await this.kafkaService.createConsumer(
        KafkaConsumerGroups.DLQ_REPROCESSORS,
        [KafkaTopics.PLATFORM_WEBHOOKS_DLQ, KafkaTopics.ORDER_STATUS_SYNC_DLQ],
        this.handleDLQMessage.bind(this),
      );
      this.logger.log('DLQ consumer started successfully');
    } catch (error) {
      this.logger.error('Failed to start DLQ consumer', error);
    }
  }

  private async handleDLQMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;

    // Parse the DLQ event
    const dlqEvent = this.kafkaService.parseMessage<DLQEvent<unknown>>(message.value);
    if (!dlqEvent) {
      this.logger.error('Failed to parse DLQ message', { topic, partition, offset: message.offset });
      return;
    }

    const { originalEvent, error: originalError, failedAt, sourceTopic } = dlqEvent.payload;
    const { correlationId, metadata } = originalEvent;
    const retryCount = metadata.retryCount;

    this.logger.log(`Processing DLQ message from ${sourceTopic}`, {
      correlationId,
      retryCount,
      failedAt,
      errorMessage: originalError.message,
    });

    // Check if we should retry based on exponential backoff
    const delay = this.RETRY_DELAYS_MS[Math.min(retryCount, this.RETRY_DELAYS_MS.length - 1)];
    const failedAtTime = new Date(failedAt).getTime();
    const shouldRetry = Date.now() - failedAtTime >= delay;

    if (!shouldRetry) {
      this.logger.debug(`DLQ message not ready for retry yet`, {
        correlationId,
        retryCount,
        nextRetryIn: delay - (Date.now() - failedAtTime),
      });
      // Message will be picked up again on next consumer poll
      // In production, consider using a delay queue or scheduled reprocessing
      return;
    }

    // Check if max retries exceeded
    if (retryCount >= this.MAX_RETRIES) {
      this.logger.error(`DLQ message exceeded max retries, marking as permanently failed`, {
        correlationId,
        retryCount,
        sourceTopic,
      });
      await this.persistFailedEvent(dlqEvent.payload, originalEvent);
      return;
    }

    // Re-queue to original topic with incremented retry count
    try {
      await this.reprocessEvent(sourceTopic, originalEvent);
      this.logger.log(`DLQ message re-queued to ${sourceTopic}`, { correlationId, retryCount });
    } catch (reprocessError) {
      this.logger.error(`Failed to reprocess DLQ message`, {
        error: reprocessError.message,
        correlationId,
      });
    }
  }

  private async reprocessEvent(
    sourceTopic: string,
    originalEvent: KafkaMessageEnvelope<unknown>,
  ): Promise<void> {
    const payload = originalEvent.payload as any;

    // Generate the message key
    const key = [
      originalEvent.metadata.tenantId,
      payload.platformType || 'unknown',
      payload.platformOrderId || originalEvent.eventId,
    ].join(':');

    await this.kafkaService.produce(sourceTopic as any, originalEvent.payload, {
      key,
      headers: {
        tenantId: originalEvent.metadata.tenantId,
        correlationId: originalEvent.correlationId,
        retryCount: String(originalEvent.metadata.retryCount + 1),
        originalTimestamp: originalEvent.timestamp.toString(),
        reprocessedAt: new Date().toISOString(),
      },
    });
  }

  private async persistFailedEvent(
    dlqEvent: DLQEvent<unknown>,
    originalEvent: KafkaMessageEnvelope<unknown>,
  ): Promise<void> {
    try {
      const payload = originalEvent.payload as WebhookReceivedEvent;

      // Store in the database for manual review/intervention
      await this.prisma.webhookDeadLetter.create({
        data: {
          tenantId: originalEvent.metadata.tenantId,
          platformType: payload.platformType || 'UNKNOWN',
          webhookType: payload.webhookType || 'UNKNOWN',
          payload: originalEvent.payload as any,
          headers: payload.headers,
          errorMessage: dlqEvent.error.message,
          status: 'FAILED',
          retryCount: originalEvent.metadata.retryCount,
          maxRetries: this.MAX_RETRIES,
        },
      });

      this.logger.log(`Failed event persisted to database for manual review`, {
        correlationId: originalEvent.correlationId,
        tenantId: originalEvent.metadata.tenantId,
      });
    } catch (dbError) {
      this.logger.error(`Failed to persist failed event to database`, {
        error: dbError.message,
        correlationId: originalEvent.correlationId,
      });
    }
  }
}
