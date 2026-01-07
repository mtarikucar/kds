import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EachMessagePayload } from 'kafkajs';
import { KafkaService } from '../kafka.service';
import { IdempotencyService } from '../services/idempotency.service';
import { DistributedLockService } from '../services/distributed-lock.service';
import { DLQProducerService } from './dlq-producer.service';
import {
  KafkaTopics,
  KafkaConsumerGroups,
  KafkaMessageEnvelope,
  WebhookReceivedEvent,
} from '../interfaces/kafka-event.interface';
import { OrderIntegrationService } from '../../order-integrations/services/order-integration.service';
import { PlatformProviderFactory } from '../../order-integrations/services/platform-provider.factory';
import { PlatformType } from '../../order-integrations/constants';

@Injectable()
export class WebhookConsumerService implements OnModuleInit {
  private readonly logger = new Logger(WebhookConsumerService.name);
  private readonly MAX_RETRIES = 3;

  constructor(
    private readonly kafkaService: KafkaService,
    private readonly configService: ConfigService,
    private readonly idempotencyService: IdempotencyService,
    private readonly lockService: DistributedLockService,
    private readonly dlqProducer: DLQProducerService,
    private readonly orderIntegrationService: OrderIntegrationService,
    private readonly providerFactory: PlatformProviderFactory,
  ) {}

  async onModuleInit() {
    const kafkaEnabled = this.configService.get<boolean>('kafka.enabled', false);
    if (!kafkaEnabled) {
      this.logger.warn('Kafka is disabled. Webhook consumer will not start.');
      return;
    }

    try {
      await this.kafkaService.createConsumer(
        KafkaConsumerGroups.WEBHOOK_PROCESSORS,
        [KafkaTopics.PLATFORM_WEBHOOKS],
        this.handleMessage.bind(this),
      );
      this.logger.log('Webhook consumer started successfully');
    } catch (error) {
      this.logger.error('Failed to start webhook consumer', error);
    }
  }

  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;
    const messageKey = message.key?.toString() || 'unknown';

    // Parse the message envelope
    const envelope = this.kafkaService.parseMessage<WebhookReceivedEvent>(message.value);
    if (!envelope) {
      this.logger.error('Failed to parse message', { topic, partition, offset: message.offset });
      return;
    }

    const { correlationId, metadata, payload: event } = envelope;
    const { tenantId, retryCount } = metadata;

    this.logger.log(
      `Processing webhook: ${event.webhookType} for ${event.platformType}/${event.platformOrderId}`,
      { correlationId, tenantId, retryCount },
    );

    // Generate idempotency key
    const idempotencyKey = this.idempotencyService.generateWebhookKey(
      tenantId,
      event.platformType,
      event.platformOrderId,
      event.webhookType,
    );

    // Check for duplicate processing
    if (await this.idempotencyService.isDuplicate(idempotencyKey)) {
      this.logger.warn(`Duplicate message detected, skipping: ${idempotencyKey}`, { correlationId });
      return;
    }

    // Acquire distributed lock to prevent race conditions
    const lockKey = `order:${tenantId}:${event.platformType}:${event.platformOrderId}`;
    const lockResult = await this.lockService.withLock(
      lockKey,
      async () => {
        // Double-check idempotency after acquiring lock
        if (await this.idempotencyService.isDuplicate(idempotencyKey)) {
          this.logger.warn(`Duplicate detected after lock acquisition: ${idempotencyKey}`);
          return { skipped: true };
        }

        // Process the webhook event
        await this.processWebhookEvent(tenantId, event, correlationId);

        // Mark as processed
        await this.idempotencyService.markProcessed(idempotencyKey, {
          correlationId,
          result: 'SUCCESS',
        });

        return { success: true };
      },
      { ttlMs: 30000 }, // 30 second lock timeout
    );

    if (!lockResult.acquired) {
      // Could not acquire lock - another instance is processing
      // Re-queue with delay if under retry limit
      if (retryCount < this.MAX_RETRIES) {
        this.logger.warn(`Lock contention, re-queuing: ${messageKey}`, { correlationId });
        await this.requeue(envelope, 1000);
      } else {
        this.logger.error(`Lock contention exceeded retry limit: ${messageKey}`, { correlationId });
        await this.sendToDLQ(envelope, new Error('Lock acquisition failed after retries'));
      }
    }
  }

  private async processWebhookEvent(
    tenantId: string,
    event: WebhookReceivedEvent,
    correlationId: string,
  ): Promise<void> {
    try {
      switch (event.webhookType) {
        case 'ORDER_CREATED':
          await this.handleOrderCreated(tenantId, event, correlationId);
          break;

        case 'ORDER_CANCELLED':
          await this.handleOrderCancelled(tenantId, event, correlationId);
          break;

        case 'ORDER_UPDATED':
        case 'STATUS_CHANGED':
          await this.handleOrderUpdated(tenantId, event, correlationId);
          break;

        default:
          this.logger.warn(`Unknown webhook type: ${event.webhookType}`, { correlationId });
      }
    } catch (error) {
      this.logger.error(`Error processing webhook event: ${error.message}`, {
        correlationId,
        webhookType: event.webhookType,
        platformType: event.platformType,
      });
      throw error;
    }
  }

  private async handleOrderCreated(
    tenantId: string,
    event: WebhookReceivedEvent,
    correlationId: string,
  ): Promise<void> {
    this.logger.log(`Handling ORDER_CREATED for ${event.platformType}/${event.platformOrderId}`, {
      correlationId,
    });

    // Get the appropriate provider
    const provider = await this.providerFactory.getProviderForTenant(
      event.platformType as PlatformType,
      tenantId,
    );

    if (!provider) {
      throw new Error(`No provider found for platform: ${event.platformType}`);
    }

    // Parse the webhook payload using the provider
    const orderData = provider.parseWebhookPayload(event.rawPayload);
    if (!orderData) {
      throw new Error('Failed to parse order data from webhook payload');
    }

    // Process the incoming order
    await this.orderIntegrationService.processIncomingOrder(
      tenantId,
      event.platformType as PlatformType,
      orderData,
    );

    this.logger.log(`ORDER_CREATED processed successfully: ${event.platformOrderId}`, {
      correlationId,
    });
  }

  private async handleOrderCancelled(
    tenantId: string,
    event: WebhookReceivedEvent,
    correlationId: string,
  ): Promise<void> {
    this.logger.log(`Handling ORDER_CANCELLED for ${event.platformType}/${event.platformOrderId}`, {
      correlationId,
    });

    const payload = event.rawPayload as any;
    const reason = payload.reason || payload.cancellationReason || 'Unknown';

    await this.orderIntegrationService.handleOrderCancellation(
      tenantId,
      event.platformType as PlatformType,
      event.platformOrderId,
      reason,
    );

    this.logger.log(`ORDER_CANCELLED processed successfully: ${event.platformOrderId}`, {
      correlationId,
    });
  }

  private async handleOrderUpdated(
    tenantId: string,
    event: WebhookReceivedEvent,
    correlationId: string,
  ): Promise<void> {
    this.logger.log(`Handling ORDER_UPDATED for ${event.platformType}/${event.platformOrderId}`, {
      correlationId,
    });

    const payload = event.rawPayload as any;
    const status = payload.status || payload.orderStatus;

    if (status) {
      await this.orderIntegrationService.handleStatusUpdate(
        tenantId,
        event.platformType as PlatformType,
        event.platformOrderId,
        status,
      );
    }

    this.logger.log(`ORDER_UPDATED processed successfully: ${event.platformOrderId}`, {
      correlationId,
    });
  }

  private async requeue(
    envelope: KafkaMessageEnvelope<WebhookReceivedEvent>,
    delayMs: number,
  ): Promise<void> {
    // Wait before re-queuing
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // Re-produce with incremented retry count
    await this.kafkaService.produce(
      KafkaTopics.PLATFORM_WEBHOOKS,
      envelope.payload,
      {
        key: `${envelope.metadata.tenantId}:${envelope.payload.platformType}:${envelope.payload.platformOrderId}`,
        headers: {
          tenantId: envelope.metadata.tenantId,
          correlationId: envelope.correlationId,
          retryCount: String(envelope.metadata.retryCount + 1),
          originalTimestamp: envelope.timestamp.toString(),
        },
      },
    );
  }

  private async sendToDLQ(
    envelope: KafkaMessageEnvelope<WebhookReceivedEvent>,
    error: Error,
  ): Promise<void> {
    await this.dlqProducer.sendToDLQ(
      KafkaTopics.PLATFORM_WEBHOOKS,
      envelope,
      error,
    );
  }
}
