import { Test, TestingModule } from '@nestjs/testing';
import { DLQProducerService } from './dlq-producer.service';
import { KafkaService } from '../kafka.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { mockKafkaEnvelope } from '../../../common/test/kafka-mock.service';
import { KafkaTopics } from '../interfaces/kafka-event.interface';

describe('DLQProducerService', () => {
  let service: DLQProducerService;
  let kafkaService: DeepMockProxy<KafkaService>;

  beforeEach(async () => {
    kafkaService = mockDeep<KafkaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DLQProducerService,
        { provide: KafkaService, useValue: kafkaService },
      ],
    }).compile();

    service = module.get<DLQProducerService>(DLQProducerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendToDLQ', () => {
    const mockEvent = mockKafkaEnvelope(
      {
        platformType: 'GETIR',
        platformOrderId: 'getir-12345',
        webhookType: 'ORDER_CREATED',
        rawPayload: {},
      },
      {
        correlationId: 'corr-123',
        tenantId: 'tenant-1',
      },
    );

    it('should produce to correct DLQ topic', async () => {
      kafkaService.produce.mockResolvedValue({} as any);

      await service.sendToDLQ(
        KafkaTopics.PLATFORM_WEBHOOKS,
        mockEvent,
        new Error('Test error'),
      );

      expect(kafkaService.produce).toHaveBeenCalledWith(
        KafkaTopics.PLATFORM_WEBHOOKS_DLQ,
        expect.objectContaining({
          originalEvent: mockEvent,
          error: expect.objectContaining({
            message: 'Test error',
          }),
          sourceTopic: KafkaTopics.PLATFORM_WEBHOOKS,
        }),
        expect.any(Object),
      );
    });

    it('should include original event and error in payload', async () => {
      kafkaService.produce.mockResolvedValue({} as any);
      const error = new Error('Processing failed');
      (error as any).code = 'ERR_PROCESSING';

      await service.sendToDLQ(KafkaTopics.PLATFORM_WEBHOOKS, mockEvent, error);

      expect(kafkaService.produce).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          originalEvent: mockEvent,
          error: expect.objectContaining({
            message: 'Processing failed',
            code: 'ERR_PROCESSING',
          }),
          failedAt: expect.any(Date),
        }),
        expect.any(Object),
      );
    });

    it('should truncate error message for headers', async () => {
      kafkaService.produce.mockResolvedValue({} as any);
      const longError = new Error('A'.repeat(300));

      await service.sendToDLQ(KafkaTopics.PLATFORM_WEBHOOKS, mockEvent, longError);

      const callArgs = kafkaService.produce.mock.calls[0];
      const headers = callArgs[2].headers;
      expect(headers.errorMessage.length).toBeLessThanOrEqual(200);
    });

    it('should not throw on production failure', async () => {
      kafkaService.produce.mockRejectedValue(new Error('Kafka unavailable'));

      await expect(
        service.sendToDLQ(KafkaTopics.PLATFORM_WEBHOOKS, mockEvent, new Error('Test')),
      ).resolves.not.toThrow();
    });

    it('should map ORDER_STATUS_SYNC to correct DLQ topic', async () => {
      kafkaService.produce.mockResolvedValue({} as any);

      await service.sendToDLQ(
        KafkaTopics.ORDER_STATUS_SYNC,
        mockEvent,
        new Error('Test'),
      );

      expect(kafkaService.produce).toHaveBeenCalledWith(
        KafkaTopics.ORDER_STATUS_SYNC_DLQ,
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('should append -dlq for unknown topics', async () => {
      kafkaService.produce.mockResolvedValue({} as any);

      await service.sendToDLQ(
        'custom-topic' as any,
        mockEvent,
        new Error('Test'),
      );

      expect(kafkaService.produce).toHaveBeenCalledWith(
        'custom-topic-dlq',
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('should generate correct key from event', async () => {
      kafkaService.produce.mockResolvedValue({} as any);

      await service.sendToDLQ(KafkaTopics.PLATFORM_WEBHOOKS, mockEvent, new Error('Test'));

      const callArgs = kafkaService.produce.mock.calls[0];
      expect(callArgs[2].key).toBe('tenant-1:GETIR:getir-12345');
    });

    it('should include tenant and correlation headers', async () => {
      kafkaService.produce.mockResolvedValue({} as any);

      await service.sendToDLQ(KafkaTopics.PLATFORM_WEBHOOKS, mockEvent, new Error('Test'));

      const callArgs = kafkaService.produce.mock.calls[0];
      expect(callArgs[2].headers).toMatchObject({
        tenantId: 'tenant-1',
        correlationId: 'corr-123',
        sourceTopic: KafkaTopics.PLATFORM_WEBHOOKS,
      });
    });
  });
});
