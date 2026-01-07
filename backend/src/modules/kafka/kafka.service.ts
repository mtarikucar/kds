import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Kafka,
  Producer,
  Consumer,
  EachMessagePayload,
  logLevel,
  CompressionTypes,
  Admin,
} from 'kafkajs';
import { randomUUID } from 'crypto';
import {
  KafkaMessageEnvelope,
  KafkaTopic,
  ProduceOptions,
  ProduceResult,
} from './interfaces/kafka-event.interface';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private kafka: Kafka;
  private producer: Producer;
  private admin: Admin;
  private consumers: Map<string, Consumer> = new Map();
  private readonly logger = new Logger(KafkaService.name);
  private isEnabled: boolean;
  private isConnected: boolean = false;

  constructor(private configService: ConfigService) {
    this.isEnabled = this.configService.get<boolean>('kafka.enabled', false);

    if (!this.isEnabled) {
      this.logger.warn('Kafka is disabled. Messages will not be produced or consumed.');
      return;
    }

    const brokers = this.configService.get<string[]>('kafka.brokers', ['localhost:9092']);
    const clientId = this.configService.get<string>('kafka.clientId', 'kds-order-integration');

    this.kafka = new Kafka({
      clientId,
      brokers,
      logLevel: logLevel.WARN,
      retry: {
        initialRetryTime: this.configService.get<number>('kafka.retry.initialRetryTime', 100),
        retries: this.configService.get<number>('kafka.retry.maxRetries', 8),
        maxRetryTime: this.configService.get<number>('kafka.retry.maxRetryTime', 30000),
      },
    });

    this.producer = this.kafka.producer({
      idempotent: this.configService.get<boolean>('kafka.producer.idempotent', true),
      maxInFlightRequests: this.configService.get<number>('kafka.producer.maxInFlightRequests', 5),
      transactionTimeout: this.configService.get<number>('kafka.producer.transactionTimeout', 60000),
    });

    this.admin = this.kafka.admin();
  }

  async onModuleInit() {
    if (!this.isEnabled) {
      return;
    }

    try {
      await this.producer.connect();
      await this.admin.connect();
      this.isConnected = true;
      this.logger.log('Kafka producer and admin connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect Kafka producer', error);
      // Don't throw - allow the application to start without Kafka
      // The produce method will check isConnected and handle gracefully
    }
  }

  async onModuleDestroy() {
    if (!this.isEnabled) {
      return;
    }

    try {
      await this.producer.disconnect();
      await this.admin.disconnect();
      for (const [groupId, consumer] of this.consumers) {
        await consumer.disconnect();
        this.logger.log(`Kafka consumer ${groupId} disconnected`);
      }
      this.isConnected = false;
      this.logger.log('Kafka connections closed');
    } catch (error) {
      this.logger.error('Error disconnecting Kafka', error);
    }
  }

  /**
   * Check if Kafka is enabled and connected
   */
  isKafkaEnabled(): boolean {
    return this.isEnabled && this.isConnected;
  }

  /**
   * Get the Kafka admin client for health checks
   */
  getAdmin(): Admin {
    return this.admin;
  }

  /**
   * Produce a message to a Kafka topic
   */
  async produce<T>(
    topic: KafkaTopic,
    event: T,
    options: ProduceOptions,
  ): Promise<ProduceResult | null> {
    if (!this.isKafkaEnabled()) {
      this.logger.warn(`Kafka disabled or not connected. Skipping message to ${topic}`);
      return null;
    }

    const { key, headers = {}, partition } = options;
    const correlationId = headers.correlationId || randomUUID();

    const envelope: KafkaMessageEnvelope<T> = {
      eventId: randomUUID(),
      eventType: this.extractEventType(event),
      timestamp: new Date(),
      version: '1.0',
      source: 'kds-order-integration',
      correlationId,
      payload: event,
      metadata: {
        tenantId: headers.tenantId || 'unknown',
        retryCount: parseInt(headers.retryCount || '0', 10),
        originalTimestamp: headers.originalTimestamp
          ? new Date(headers.originalTimestamp)
          : undefined,
      },
    };

    try {
      const result = await this.producer.send({
        topic,
        compression: CompressionTypes.GZIP,
        messages: [
          {
            key,
            value: JSON.stringify(envelope),
            headers: {
              ...headers,
              correlationId,
              timestamp: Date.now().toString(),
            },
            partition,
          },
        ],
      });

      const record = result[0];
      this.logger.debug(
        `Message sent to ${topic}[${record.partition}] offset ${record.baseOffset}`,
        { correlationId, key },
      );

      return {
        topic,
        partition: record.partition,
        offset: record.baseOffset,
        timestamp: Date.now().toString(),
      };
    } catch (error) {
      this.logger.error(`Failed to produce message to ${topic}`, {
        error: error.message,
        key,
        correlationId,
      });
      throw error;
    }
  }

  /**
   * Create and start a consumer for the specified topics
   */
  async createConsumer(
    groupId: string,
    topics: string[],
    handler: (payload: EachMessagePayload) => Promise<void>,
  ): Promise<Consumer | null> {
    if (!this.isKafkaEnabled()) {
      this.logger.warn(`Kafka disabled. Skipping consumer creation for ${groupId}`);
      return null;
    }

    const consumer = this.kafka.consumer({
      groupId,
      sessionTimeout: this.configService.get<number>('kafka.consumer.sessionTimeout', 30000),
      heartbeatInterval: this.configService.get<number>('kafka.consumer.heartbeatInterval', 3000),
      maxBytesPerPartition: this.configService.get<number>('kafka.consumer.maxBytesPerPartition', 1048576),
    });

    try {
      await consumer.connect();
      await consumer.subscribe({ topics, fromBeginning: false });

      await consumer.run({
        eachMessage: async (payload) => {
          const { topic, partition, message } = payload;
          const correlationId = message.headers?.correlationId?.toString() || 'unknown';

          this.logger.debug(
            `Processing message from ${topic}[${partition}] offset ${message.offset}`,
            { correlationId },
          );

          try {
            await handler(payload);
          } catch (error) {
            this.logger.error(
              `Error processing message from ${topic}[${partition}]`,
              { error: error.message, correlationId, offset: message.offset },
            );
            // Let the handler manage DLQ logic
            throw error;
          }
        },
      });

      this.consumers.set(groupId, consumer);
      this.logger.log(`Kafka consumer ${groupId} started for topics: ${topics.join(', ')}`);

      return consumer;
    } catch (error) {
      this.logger.error(`Failed to create consumer ${groupId}`, error);
      throw error;
    }
  }

  /**
   * Parse a Kafka message value into an envelope
   */
  parseMessage<T>(value: Buffer | string | null): KafkaMessageEnvelope<T> | null {
    if (!value) {
      return null;
    }

    try {
      const str = typeof value === 'string' ? value : value.toString();
      return JSON.parse(str) as KafkaMessageEnvelope<T>;
    } catch (error) {
      this.logger.error('Failed to parse Kafka message', error);
      return null;
    }
  }

  /**
   * Extract event type from the event payload
   */
  private extractEventType(event: any): string {
    if (event.webhookType) {
      return `WEBHOOK_${event.webhookType}`;
    }
    if (event.targetStatus) {
      return 'STATUS_SYNC';
    }
    return 'UNKNOWN';
  }

  /**
   * Get consumer lag for health monitoring
   */
  async getConsumerLag(groupId: string): Promise<Record<string, number>> {
    if (!this.isKafkaEnabled()) {
      return {};
    }

    try {
      const groups = await this.admin.describeGroups([groupId]);
      const group = groups.groups[0];

      if (!group || group.state === 'Dead') {
        return {};
      }

      const offsets = await this.admin.fetchOffsets({ groupId });
      const lagMetrics: Record<string, number> = {};

      for (const topicOffset of offsets) {
        const topicMetadata = await this.admin.fetchTopicOffsets(topicOffset.topic);
        let totalLag = 0;

        for (const partitionOffset of topicOffset.partitions) {
          const latest = topicMetadata.find(
            (t) => t.partition === partitionOffset.partition,
          );
          if (latest) {
            const lag = Number(latest.offset) - Number(partitionOffset.offset);
            totalLag += Math.max(0, lag);
          }
        }

        lagMetrics[topicOffset.topic] = totalLag;
      }

      return lagMetrics;
    } catch (error) {
      this.logger.error(`Failed to get consumer lag for ${groupId}`, error);
      return {};
    }
  }
}
