import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { KafkaService } from './kafka.service';
import { KafkaTopics } from './interfaces/kafka-event.interface';

// Mock kafkajs
jest.mock('kafkajs', () => {
  const mockProducer = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue([
      {
        topicName: 'test-topic',
        partition: 0,
        baseOffset: '0',
        errorCode: 0,
      },
    ]),
  };

  const mockConsumer = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    run: jest.fn().mockResolvedValue(undefined),
  };

  const mockAdmin = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    describeGroups: jest.fn().mockResolvedValue({ groups: [] }),
    fetchOffsets: jest.fn().mockResolvedValue([]),
    fetchTopicOffsets: jest.fn().mockResolvedValue([]),
  };

  return {
    Kafka: jest.fn().mockImplementation(() => ({
      producer: jest.fn().mockReturnValue(mockProducer),
      consumer: jest.fn().mockReturnValue(mockConsumer),
      admin: jest.fn().mockReturnValue(mockAdmin),
    })),
    logLevel: { WARN: 4 },
    CompressionTypes: { GZIP: 1 },
    __mockProducer: mockProducer,
    __mockConsumer: mockConsumer,
    __mockAdmin: mockAdmin,
  };
});

const kafkajs = require('kafkajs');

describe('KafkaService', () => {
  let service: KafkaService;
  let configService: ConfigService;

  const mockConfigEnabled = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config: Record<string, any> = {
        'kafka.enabled': true,
        'kafka.brokers': ['localhost:9092'],
        'kafka.clientId': 'test-client',
        'kafka.retry.initialRetryTime': 100,
        'kafka.retry.maxRetries': 8,
        'kafka.retry.maxRetryTime': 30000,
        'kafka.producer.idempotent': true,
        'kafka.producer.maxInFlightRequests': 5,
        'kafka.producer.transactionTimeout': 60000,
        'kafka.consumer.sessionTimeout': 30000,
        'kafka.consumer.heartbeatInterval': 3000,
        'kafka.consumer.maxBytesPerPartition': 1048576,
      };
      return config[key] ?? defaultValue;
    }),
  };

  const mockConfigDisabled = {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'kafka.enabled') return false;
      return defaultValue;
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('when Kafka is disabled', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          KafkaService,
          {
            provide: ConfigService,
            useValue: mockConfigDisabled,
          },
        ],
      }).compile();

      service = module.get<KafkaService>(KafkaService);
    });

    it('should not initialize Kafka client', () => {
      expect(service.isKafkaEnabled()).toBe(false);
    });

    it('should skip onModuleInit when disabled', async () => {
      await service.onModuleInit();
      expect(kafkajs.__mockProducer.connect).not.toHaveBeenCalled();
    });

    it('should skip onModuleDestroy when disabled', async () => {
      await service.onModuleDestroy();
      expect(kafkajs.__mockProducer.disconnect).not.toHaveBeenCalled();
    });

    it('should return null when producing message while disabled', async () => {
      const result = await service.produce(
        KafkaTopics.PLATFORM_WEBHOOKS,
        { test: 'data' },
        { key: 'test-key' },
      );
      expect(result).toBeNull();
    });

    it('should return null when creating consumer while disabled', async () => {
      const result = await service.createConsumer(
        'test-group',
        ['test-topic'],
        jest.fn(),
      );
      expect(result).toBeNull();
    });

    it('should return empty object for consumer lag when disabled', async () => {
      const result = await service.getConsumerLag('test-group');
      expect(result).toEqual({});
    });
  });

  describe('when Kafka is enabled', () => {
    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          KafkaService,
          {
            provide: ConfigService,
            useValue: mockConfigEnabled,
          },
        ],
      }).compile();

      service = module.get<KafkaService>(KafkaService);
    });

    describe('onModuleInit', () => {
      it('should connect producer and admin on init', async () => {
        await service.onModuleInit();

        expect(kafkajs.__mockProducer.connect).toHaveBeenCalled();
        expect(kafkajs.__mockAdmin.connect).toHaveBeenCalled();
        expect(service.isKafkaEnabled()).toBe(true);
      });

      it('should handle connection failure gracefully', async () => {
        kafkajs.__mockProducer.connect.mockRejectedValueOnce(new Error('Connection failed'));

        // Should not throw
        await expect(service.onModuleInit()).resolves.not.toThrow();
        expect(service.isKafkaEnabled()).toBe(false);
      });
    });

    describe('onModuleDestroy', () => {
      it('should disconnect all clients', async () => {
        await service.onModuleInit();
        await service.onModuleDestroy();

        expect(kafkajs.__mockProducer.disconnect).toHaveBeenCalled();
        expect(kafkajs.__mockAdmin.disconnect).toHaveBeenCalled();
      });

      it('should handle disconnect errors gracefully', async () => {
        await service.onModuleInit();
        kafkajs.__mockProducer.disconnect.mockRejectedValueOnce(new Error('Disconnect failed'));

        await expect(service.onModuleDestroy()).resolves.not.toThrow();
      });
    });

    describe('isKafkaEnabled', () => {
      it('should return false when not connected', () => {
        expect(service.isKafkaEnabled()).toBe(false);
      });

      it('should return true when connected', async () => {
        await service.onModuleInit();
        expect(service.isKafkaEnabled()).toBe(true);
      });
    });

    describe('produce', () => {
      beforeEach(async () => {
        await service.onModuleInit();
      });

      it('should produce message with correct envelope structure', async () => {
        const event = { test: 'data', webhookType: 'ORDER_CREATED' };

        const result = await service.produce(
          KafkaTopics.PLATFORM_WEBHOOKS,
          event,
          { key: 'test-key', headers: { tenantId: 'tenant-1' } },
        );

        expect(result).toBeDefined();
        expect(result?.topic).toBe(KafkaTopics.PLATFORM_WEBHOOKS);
        expect(kafkajs.__mockProducer.send).toHaveBeenCalledWith(
          expect.objectContaining({
            topic: KafkaTopics.PLATFORM_WEBHOOKS,
            compression: 1, // GZIP
            messages: expect.arrayContaining([
              expect.objectContaining({
                key: 'test-key',
              }),
            ]),
          }),
        );
      });

      it('should generate correlationId if not provided', async () => {
        await service.produce(
          KafkaTopics.PLATFORM_WEBHOOKS,
          { test: 'data' },
          { key: 'test-key' },
        );

        const sendCall = kafkajs.__mockProducer.send.mock.calls[0][0];
        const message = sendCall.messages[0];
        expect(message.headers.correlationId).toBeDefined();
      });

      it('should use provided correlationId', async () => {
        await service.produce(
          KafkaTopics.PLATFORM_WEBHOOKS,
          { test: 'data' },
          { key: 'test-key', headers: { correlationId: 'custom-correlation-id' } },
        );

        const sendCall = kafkajs.__mockProducer.send.mock.calls[0][0];
        const message = sendCall.messages[0];
        expect(message.headers.correlationId).toBe('custom-correlation-id');
      });

      it('should throw on production failure', async () => {
        kafkajs.__mockProducer.send.mockRejectedValueOnce(new Error('Send failed'));

        await expect(
          service.produce(
            KafkaTopics.PLATFORM_WEBHOOKS,
            { test: 'data' },
            { key: 'test-key' },
          ),
        ).rejects.toThrow('Send failed');
      });

      it('should skip production when not connected', async () => {
        await service.onModuleDestroy();

        const result = await service.produce(
          KafkaTopics.PLATFORM_WEBHOOKS,
          { test: 'data' },
          { key: 'test-key' },
        );

        expect(result).toBeNull();
      });
    });

    describe('createConsumer', () => {
      beforeEach(async () => {
        await service.onModuleInit();
      });

      it('should create and start consumer with correct config', async () => {
        const handler = jest.fn();

        const consumer = await service.createConsumer(
          'test-group',
          ['test-topic'],
          handler,
        );

        expect(consumer).toBeDefined();
        expect(kafkajs.__mockConsumer.connect).toHaveBeenCalled();
        expect(kafkajs.__mockConsumer.subscribe).toHaveBeenCalledWith({
          topics: ['test-topic'],
          fromBeginning: false,
        });
        expect(kafkajs.__mockConsumer.run).toHaveBeenCalled();
      });

      it('should skip consumer creation when not connected', async () => {
        await service.onModuleDestroy();

        const consumer = await service.createConsumer(
          'test-group',
          ['test-topic'],
          jest.fn(),
        );

        expect(consumer).toBeNull();
      });

      it('should throw on consumer creation failure', async () => {
        kafkajs.__mockConsumer.connect.mockRejectedValueOnce(new Error('Consumer connect failed'));

        await expect(
          service.createConsumer('test-group', ['test-topic'], jest.fn()),
        ).rejects.toThrow('Consumer connect failed');
      });
    });

    describe('parseMessage', () => {
      it('should parse valid JSON buffer', () => {
        const envelope = {
          eventId: 'test-event',
          payload: { data: 'test' },
        };
        const buffer = Buffer.from(JSON.stringify(envelope));

        const result = service.parseMessage(buffer);

        expect(result).toEqual(envelope);
      });

      it('should parse valid JSON string', () => {
        const envelope = {
          eventId: 'test-event',
          payload: { data: 'test' },
        };

        const result = service.parseMessage(JSON.stringify(envelope));

        expect(result).toEqual(envelope);
      });

      it('should return null for invalid JSON', () => {
        const result = service.parseMessage('invalid-json');
        expect(result).toBeNull();
      });

      it('should return null for null value', () => {
        const result = service.parseMessage(null);
        expect(result).toBeNull();
      });
    });

    describe('getConsumerLag', () => {
      beforeEach(async () => {
        await service.onModuleInit();
      });

      it('should return empty object when group not found', async () => {
        kafkajs.__mockAdmin.describeGroups.mockResolvedValueOnce({
          groups: [{ state: 'Dead' }],
        });

        const result = await service.getConsumerLag('test-group');
        expect(result).toEqual({});
      });

      it('should calculate lag correctly', async () => {
        kafkajs.__mockAdmin.describeGroups.mockResolvedValueOnce({
          groups: [{ state: 'Stable' }],
        });
        kafkajs.__mockAdmin.fetchOffsets.mockResolvedValueOnce([
          {
            topic: 'test-topic',
            partitions: [{ partition: 0, offset: '5' }],
          },
        ]);
        kafkajs.__mockAdmin.fetchTopicOffsets.mockResolvedValueOnce([
          { partition: 0, offset: '10' },
        ]);

        const result = await service.getConsumerLag('test-group');
        expect(result['test-topic']).toBe(5);
      });

      it('should return empty object on error', async () => {
        kafkajs.__mockAdmin.describeGroups.mockRejectedValueOnce(new Error('Admin error'));

        const result = await service.getConsumerLag('test-group');
        expect(result).toEqual({});
      });
    });

    describe('getAdmin', () => {
      it('should return the admin client', async () => {
        await service.onModuleInit();
        const admin = service.getAdmin();
        expect(admin).toBeDefined();
      });
    });
  });
});
