import { PlatformType } from '../../order-integrations/constants';

/**
 * Kafka Topics used in the order integration system
 */
export const KafkaTopics = {
  PLATFORM_WEBHOOKS: 'platform-webhooks',
  PLATFORM_WEBHOOKS_DLQ: 'platform-webhooks-dlq',
  ORDER_STATUS_SYNC: 'order-status-sync',
  ORDER_STATUS_SYNC_DLQ: 'order-status-sync-dlq',
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];

/**
 * Consumer groups for Kafka consumers
 */
export const KafkaConsumerGroups = {
  WEBHOOK_PROCESSORS: 'webhook-processors',
  STATUS_SYNC_WORKERS: 'status-sync-workers',
  DLQ_REPROCESSORS: 'dlq-reprocessors',
} as const;

/**
 * Webhook event types received from delivery platforms
 */
export type WebhookEventType =
  | 'ORDER_CREATED'
  | 'ORDER_CANCELLED'
  | 'ORDER_UPDATED'
  | 'STATUS_CHANGED';

/**
 * Base envelope for all Kafka messages
 * Provides consistent structure for event tracking and retry logic
 */
export interface KafkaMessageEnvelope<T> {
  eventId: string;
  eventType: string;
  timestamp: Date;
  version: string;
  source: string;
  correlationId: string;
  payload: T;
  metadata: KafkaMessageMetadata;
}

export interface KafkaMessageMetadata {
  tenantId: string;
  retryCount: number;
  originalTimestamp?: Date;
  processedAt?: Date;
}

/**
 * Webhook received event - produced when a webhook is received from a platform
 */
export interface WebhookReceivedEvent {
  platformType: PlatformType;
  platformOrderId: string;
  webhookType: WebhookEventType;
  rawPayload: unknown;
  headers: Record<string, string>;
  receivedAt: Date;
}

/**
 * Order created event - produced after successfully processing an order
 */
export interface OrderCreatedEvent {
  platformOrderId: string;
  platformType: PlatformType;
  orderId?: string;
  status: string;
}

/**
 * Order status changed event - produced when order status changes
 */
export interface OrderStatusChangedEvent {
  orderId: string;
  platformOrderId: string;
  platformType: PlatformType;
  previousStatus: string;
  newStatus: string;
  changedBy: 'INTERNAL' | 'PLATFORM';
}

/**
 * Status sync event - produced when status needs to be synced to platform
 */
export interface StatusSyncEvent {
  orderId: string;
  platformOrderId: string;
  platformType: PlatformType;
  targetStatus: string;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
}

/**
 * Dead letter queue event - wraps failed events for retry
 */
export interface DLQEvent<T> {
  originalEvent: KafkaMessageEnvelope<T>;
  error: {
    message: string;
    code?: string;
    stack?: string;
  };
  failedAt: Date;
  sourceTopic: string;
}

/**
 * Options for producing messages to Kafka
 */
export interface ProduceOptions {
  key: string;
  topic?: KafkaTopic;
  headers?: Record<string, string>;
  partition?: number;
}

/**
 * Result of producing a message to Kafka
 */
export interface ProduceResult {
  topic: string;
  partition: number;
  offset: string;
  timestamp: string;
}
