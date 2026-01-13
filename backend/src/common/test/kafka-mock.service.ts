import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Kafka, Producer, Consumer, Admin, RecordMetadata } from 'kafkajs';

export type MockKafka = DeepMockProxy<Kafka>;
export type MockProducer = DeepMockProxy<Producer>;
export type MockConsumer = DeepMockProxy<Consumer>;
export type MockAdmin = DeepMockProxy<Admin>;

export interface MockKafkaSetup {
  kafka: MockKafka;
  producer: MockProducer;
  consumer: MockConsumer;
  admin: MockAdmin;
}

/**
 * Create mock Kafka instances for testing
 */
export function mockKafkaClient(): MockKafkaSetup {
  const producer = mockDeep<Producer>();
  const consumer = mockDeep<Consumer>();
  const admin = mockDeep<Admin>();
  const kafka = mockDeep<Kafka>();

  kafka.producer.mockReturnValue(producer);
  kafka.consumer.mockReturnValue(consumer);
  kafka.admin.mockReturnValue(admin);

  // Default producer behavior
  producer.connect.mockResolvedValue(undefined);
  producer.disconnect.mockResolvedValue(undefined);
  producer.send.mockResolvedValue([
    {
      topicName: 'test-topic',
      partition: 0,
      baseOffset: '0',
      errorCode: 0,
      logAppendTime: '-1',
      logStartOffset: '0',
    } as RecordMetadata,
  ]);

  // Default consumer behavior
  consumer.connect.mockResolvedValue(undefined);
  consumer.disconnect.mockResolvedValue(undefined);
  consumer.subscribe.mockResolvedValue(undefined);
  consumer.run.mockResolvedValue(undefined);

  // Default admin behavior
  admin.connect.mockResolvedValue(undefined);
  admin.disconnect.mockResolvedValue(undefined);

  return { kafka, producer, consumer, admin };
}

/**
 * Create a mock Kafka message payload
 */
export function mockKafkaMessage(options: {
  topic?: string;
  partition?: number;
  offset?: string;
  value?: string | null;
  key?: string | null;
  headers?: Record<string, string>;
}) {
  return {
    topic: options.topic || 'test-topic',
    partition: options.partition || 0,
    message: {
      key: options.key ? Buffer.from(options.key) : null,
      value: options.value ? Buffer.from(options.value) : null,
      timestamp: Date.now().toString(),
      size: options.value?.length || 0,
      attributes: 0,
      offset: options.offset || '0',
      headers: options.headers
        ? Object.fromEntries(
            Object.entries(options.headers).map(([k, v]) => [k, Buffer.from(v)]),
          )
        : {},
    },
    heartbeat: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn(),
  };
}

/**
 * Create a mock Kafka message envelope
 */
export function mockKafkaEnvelope<T>(payload: T, options?: {
  eventId?: string;
  eventType?: string;
  correlationId?: string;
  tenantId?: string;
  retryCount?: number;
}) {
  return {
    eventId: options?.eventId || 'event-123',
    eventType: options?.eventType || 'TEST_EVENT',
    timestamp: new Date(),
    version: '1.0',
    source: 'kds-order-integration',
    correlationId: options?.correlationId || 'correlation-123',
    payload,
    metadata: {
      tenantId: options?.tenantId || 'tenant-1',
      retryCount: options?.retryCount || 0,
    },
  };
}
