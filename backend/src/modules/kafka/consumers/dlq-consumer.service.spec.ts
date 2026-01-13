import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DLQConsumerService } from './dlq-consumer.service';
import { KafkaService } from '../kafka.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import {
  mockKafkaEnvelope,
  mockKafkaMessage,
} from '../../../common/test/kafka-mock.service';
import { KafkaTopics, KafkaConsumerGroups } from '../interfaces/kafka-event.interface';

describe('DLQConsumerService', () => {
  let service: DLQConsumerService;
  let kafkaService: DeepMockProxy<KafkaService>;
  let prismaService: DeepMockProxy<PrismaService>;

  const mockConfigEnabled = {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'kafka.enabled') return true;
      if (key === 'kafka.useKafkaDLQ') return true;
      return defaultValue;
    }),
  };

  const mockConfigDisabled = {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'kafka.enabled') return false;
      if (key === 'kafka.useKafkaDLQ') return false;
      return defaultValue;
    }),
  };

  beforeEach(async () => {
    kafkaService = mockDeep<KafkaService>();
    prismaService = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DLQConsumerService,
        { provide: KafkaService, useValue: kafkaService },
        { provide: ConfigService, useValue: mockConfigEnabled },
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    service = module.get<DLQConsumerService>(DLQConsumerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should skip when kafka or useKafkaDLQ disabled', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          DLQConsumerService,
          { provide: KafkaService, useValue: kafkaService },
          { provide: ConfigService, useValue: mockConfigDisabled },
          { provide: PrismaService, useValue: prismaService },
        ],
      }).compile();

      const disabledService = module.get<DLQConsumerService>(DLQConsumerService);
      await disabledService.onModuleInit();

      expect(kafkaService.createConsumer).not.toHaveBeenCalled();
    });

    it('should create consumer for DLQ topics', async () => {
      kafkaService.createConsumer.mockResolvedValue({} as any);

      await service.onModuleInit();

      expect(kafkaService.createConsumer).toHaveBeenCalledWith(
        KafkaConsumerGroups.DLQ_REPROCESSORS,
        [KafkaTopics.PLATFORM_WEBHOOKS_DLQ, KafkaTopics.ORDER_STATUS_SYNC_DLQ],
        expect.any(Function),
      );
    });

    it('should handle consumer creation failure gracefully', async () => {
      kafkaService.createConsumer.mockRejectedValue(new Error('Failed to create consumer'));

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('handleDLQMessage', () => {
    const originalEvent = mockKafkaEnvelope(
      {
        platformType: 'GETIR',
        platformOrderId: 'getir-12345',
        webhookType: 'ORDER_CREATED',
        rawPayload: {},
      },
      {
        correlationId: 'corr-123',
        tenantId: 'tenant-1',
        retryCount: 0,
      },
    );

    const dlqEvent = mockKafkaEnvelope(
      {
        originalEvent,
        error: { message: 'Processing failed' },
        failedAt: new Date(Date.now() - 120000), // 2 minutes ago
        sourceTopic: KafkaTopics.PLATFORM_WEBHOOKS,
      },
      { correlationId: 'corr-123', tenantId: 'tenant-1' },
    );

    beforeEach(() => {
      kafkaService.parseMessage.mockReturnValue(dlqEvent);
    });

    it('should skip processing if not ready for retry (backoff)', async () => {
      // Set failedAt to just now (not ready for retry)
      const recentDlqEvent = mockKafkaEnvelope(
        {
          originalEvent,
          error: { message: 'Processing failed' },
          failedAt: new Date(), // Just now
          sourceTopic: KafkaTopics.PLATFORM_WEBHOOKS,
        },
        { correlationId: 'corr-123', tenantId: 'tenant-1' },
      );
      kafkaService.parseMessage.mockReturnValue(recentDlqEvent);

      const payload = mockKafkaMessage({
        value: JSON.stringify(recentDlqEvent),
      });

      await (service as any).handleDLQMessage(payload);

      expect(kafkaService.produce).not.toHaveBeenCalled();
      expect(prismaService.webhookDeadLetter.create).not.toHaveBeenCalled();
    });

    it('should persist to database when max retries exceeded', async () => {
      const maxRetryEvent = mockKafkaEnvelope(
        {
          platformType: 'GETIR',
          platformOrderId: 'getir-12345',
          webhookType: 'ORDER_CREATED',
          rawPayload: {},
        },
        {
          correlationId: 'corr-123',
          tenantId: 'tenant-1',
          retryCount: 5, // Max retries
        },
      );

      const maxRetryDlqEvent = mockKafkaEnvelope(
        {
          originalEvent: maxRetryEvent,
          error: { message: 'Processing failed' },
          failedAt: new Date(Date.now() - 4000000), // Long time ago
          sourceTopic: KafkaTopics.PLATFORM_WEBHOOKS,
        },
        { correlationId: 'corr-123', tenantId: 'tenant-1' },
      );

      kafkaService.parseMessage.mockReturnValue(maxRetryDlqEvent);
      prismaService.webhookDeadLetter.create.mockResolvedValue({} as any);

      const payload = mockKafkaMessage({
        value: JSON.stringify(maxRetryDlqEvent),
      });

      await (service as any).handleDLQMessage(payload);

      expect(prismaService.webhookDeadLetter.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          platformType: 'GETIR',
          status: 'FAILED',
          retryCount: 5,
        }),
      });
    });

    it('should requeue to original topic with incremented retry', async () => {
      // Set failedAt to allow retry (more than 1 minute ago for retryCount 0)
      const readyDlqEvent = mockKafkaEnvelope(
        {
          originalEvent,
          error: { message: 'Processing failed' },
          failedAt: new Date(Date.now() - 120000), // 2 minutes ago
          sourceTopic: KafkaTopics.PLATFORM_WEBHOOKS,
        },
        { correlationId: 'corr-123', tenantId: 'tenant-1' },
      );
      kafkaService.parseMessage.mockReturnValue(readyDlqEvent);
      kafkaService.produce.mockResolvedValue({} as any);

      const payload = mockKafkaMessage({
        value: JSON.stringify(readyDlqEvent),
      });

      await (service as any).handleDLQMessage(payload);

      expect(kafkaService.produce).toHaveBeenCalledWith(
        KafkaTopics.PLATFORM_WEBHOOKS,
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            retryCount: '1',
          }),
        }),
      );
    });

    it('should return early for unparseable messages', async () => {
      kafkaService.parseMessage.mockReturnValue(null);

      const payload = mockKafkaMessage({
        value: 'invalid-json',
      });

      await (service as any).handleDLQMessage(payload);

      expect(kafkaService.produce).not.toHaveBeenCalled();
    });

    it('should handle reprocessing failure gracefully', async () => {
      const readyDlqEvent = mockKafkaEnvelope(
        {
          originalEvent,
          error: { message: 'Processing failed' },
          failedAt: new Date(Date.now() - 120000),
          sourceTopic: KafkaTopics.PLATFORM_WEBHOOKS,
        },
        { correlationId: 'corr-123', tenantId: 'tenant-1' },
      );
      kafkaService.parseMessage.mockReturnValue(readyDlqEvent);
      kafkaService.produce.mockRejectedValue(new Error('Kafka unavailable'));

      const payload = mockKafkaMessage({
        value: JSON.stringify(readyDlqEvent),
      });

      await expect((service as any).handleDLQMessage(payload)).resolves.not.toThrow();
    });

    it('should calculate correct exponential backoff delay', async () => {
      // Test that delay increases with retry count
      const retryDelays = [60000, 300000, 900000, 1800000, 3600000];

      for (let i = 0; i < retryDelays.length; i++) {
        const retryEvent = mockKafkaEnvelope(
          {
            platformType: 'GETIR',
            platformOrderId: 'getir-12345',
            webhookType: 'ORDER_CREATED',
            rawPayload: {},
          },
          {
            correlationId: 'corr-123',
            tenantId: 'tenant-1',
            retryCount: i,
          },
        );

        // Set failedAt to just before the required delay
        const notReadyDlqEvent = mockKafkaEnvelope(
          {
            originalEvent: retryEvent,
            error: { message: 'Processing failed' },
            failedAt: new Date(Date.now() - retryDelays[i] + 5000), // 5 seconds before ready
            sourceTopic: KafkaTopics.PLATFORM_WEBHOOKS,
          },
          { correlationId: 'corr-123', tenantId: 'tenant-1' },
        );

        kafkaService.parseMessage.mockReturnValue(notReadyDlqEvent);

        const payload = mockKafkaMessage({
          value: JSON.stringify(notReadyDlqEvent),
        });

        await (service as any).handleDLQMessage(payload);

        // Should not requeue because delay hasn't passed
        expect(kafkaService.produce).not.toHaveBeenCalled();

        jest.clearAllMocks();
      }
    });
  });
});
