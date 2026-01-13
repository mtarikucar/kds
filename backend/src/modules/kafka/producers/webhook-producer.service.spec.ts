import { Test, TestingModule } from '@nestjs/testing';
import { WebhookProducerService, WebhookProduceParams } from './webhook-producer.service';
import { KafkaService } from '../kafka.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { KafkaTopics } from '../interfaces/kafka-event.interface';
import { PlatformType } from '../../order-integrations/constants';

describe('WebhookProducerService', () => {
  let service: WebhookProducerService;
  let kafkaService: DeepMockProxy<KafkaService>;

  beforeEach(async () => {
    kafkaService = mockDeep<KafkaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookProducerService,
        { provide: KafkaService, useValue: kafkaService },
      ],
    }).compile();

    service = module.get<WebhookProducerService>(WebhookProducerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isEnabled', () => {
    it('should delegate to kafkaService.isKafkaEnabled', () => {
      kafkaService.isKafkaEnabled.mockReturnValue(true);

      const result = service.isEnabled();

      expect(result).toBe(true);
      expect(kafkaService.isKafkaEnabled).toHaveBeenCalled();
    });

    it('should return false when kafka is disabled', () => {
      kafkaService.isKafkaEnabled.mockReturnValue(false);

      const result = service.isEnabled();

      expect(result).toBe(false);
    });
  });

  describe('produce', () => {
    const baseParams: WebhookProduceParams = {
      tenantId: 'tenant-1',
      platformType: PlatformType.GETIR,
      platformOrderId: 'getir-12345',
      webhookType: 'ORDER_CREATED',
      rawPayload: { id: 'getir-12345', status: 'NEW' },
    };

    it('should produce webhook event with correct structure', async () => {
      kafkaService.produce.mockResolvedValue({
        topic: KafkaTopics.PLATFORM_WEBHOOKS,
        partition: 0,
        offset: '0',
        timestamp: Date.now().toString(),
      });

      const result = await service.produce(baseParams);

      expect(result).toBeDefined();
      expect(kafkaService.produce).toHaveBeenCalledWith(
        KafkaTopics.PLATFORM_WEBHOOKS,
        expect.objectContaining({
          platformType: PlatformType.GETIR,
          platformOrderId: 'getir-12345',
          webhookType: 'ORDER_CREATED',
          rawPayload: baseParams.rawPayload,
          receivedAt: expect.any(Date),
        }),
        expect.objectContaining({
          key: 'tenant-1:GETIR:getir-12345',
          headers: expect.objectContaining({
            tenantId: 'tenant-1',
            platformType: 'GETIR',
            webhookType: 'ORDER_CREATED',
          }),
        }),
      );
    });

    it('should generate correlationId when not provided', async () => {
      kafkaService.produce.mockResolvedValue({} as any);

      await service.produce(baseParams);

      const callArgs = kafkaService.produce.mock.calls[0];
      expect(callArgs[2].headers.correlationId).toBeDefined();
      expect(typeof callArgs[2].headers.correlationId).toBe('string');
    });

    it('should use provided correlationId', async () => {
      kafkaService.produce.mockResolvedValue({} as any);

      await service.produce({
        ...baseParams,
        correlationId: 'custom-corr-id',
      });

      const callArgs = kafkaService.produce.mock.calls[0];
      expect(callArgs[2].headers.correlationId).toBe('custom-corr-id');
    });

    it('should throw on production failure', async () => {
      kafkaService.produce.mockRejectedValue(new Error('Kafka unavailable'));

      await expect(service.produce(baseParams)).rejects.toThrow('Kafka unavailable');
    });

    it('should return null when kafka returns null', async () => {
      kafkaService.produce.mockResolvedValue(null);

      const result = await service.produce(baseParams);

      expect(result).toBeNull();
    });
  });

  describe('produceBatch', () => {
    const events: WebhookProduceParams[] = [
      {
        tenantId: 'tenant-1',
        platformType: PlatformType.GETIR,
        platformOrderId: 'getir-1',
        webhookType: 'ORDER_CREATED',
        rawPayload: {},
      },
      {
        tenantId: 'tenant-1',
        platformType: PlatformType.TRENDYOL,
        platformOrderId: 'trendyol-1',
        webhookType: 'ORDER_CREATED',
        rawPayload: {},
      },
    ];

    it('should produce all events', async () => {
      kafkaService.produce.mockResolvedValue({} as any);

      const results = await service.produceBatch(events);

      expect(results).toHaveLength(2);
      expect(kafkaService.produce).toHaveBeenCalledTimes(2);
    });

    it('should continue on individual event failure', async () => {
      kafkaService.produce
        .mockRejectedValueOnce(new Error('First failed'))
        .mockResolvedValueOnce({} as any);

      const results = await service.produceBatch(events);

      expect(results).toHaveLength(2);
      expect(results[0]).toBeNull();
      expect(results[1]).toBeDefined();
    });

    it('should return null for failed events', async () => {
      kafkaService.produce.mockRejectedValue(new Error('All failed'));

      const results = await service.produceBatch(events);

      expect(results.every((r) => r === null)).toBe(true);
    });
  });

  describe('generateKey', () => {
    it('should generate correct composite key', () => {
      const key = service.generateKey('tenant-1', PlatformType.GETIR, 'order-123');

      expect(key).toBe('tenant-1:GETIR:order-123');
    });

    it('should handle string platform type', () => {
      const key = service.generateKey('tenant-1', 'YEMEKSEPETI', 'order-456');

      expect(key).toBe('tenant-1:YEMEKSEPETI:order-456');
    });
  });
});
