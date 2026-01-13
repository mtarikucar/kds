import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhookConsumerService } from './webhook-consumer.service';
import { KafkaService } from '../kafka.service';
import { IdempotencyService } from '../services/idempotency.service';
import { DistributedLockService } from '../services/distributed-lock.service';
import { DLQProducerService } from './dlq-producer.service';
import { OrderIntegrationService } from '../../order-integrations/services/order-integration.service';
import { PlatformProviderFactory } from '../../order-integrations/services/platform-provider.factory';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import {
  mockKafkaEnvelope,
  mockKafkaMessage,
} from '../../../common/test/kafka-mock.service';
import { mockWebhookReceivedEvent } from '../../../common/test/platform-order-mock';

describe('WebhookConsumerService', () => {
  let service: WebhookConsumerService;
  let kafkaService: DeepMockProxy<KafkaService>;
  let idempotencyService: DeepMockProxy<IdempotencyService>;
  let lockService: DeepMockProxy<DistributedLockService>;
  let dlqProducer: DeepMockProxy<DLQProducerService>;
  let orderIntegrationService: DeepMockProxy<OrderIntegrationService>;
  let providerFactory: DeepMockProxy<PlatformProviderFactory>;
  let configService: ConfigService;

  const mockConfigEnabled = {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'kafka.enabled') return true;
      return defaultValue;
    }),
  };

  const mockConfigDisabled = {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'kafka.enabled') return false;
      return defaultValue;
    }),
  };

  beforeEach(async () => {
    kafkaService = mockDeep<KafkaService>();
    idempotencyService = mockDeep<IdempotencyService>();
    lockService = mockDeep<DistributedLockService>();
    dlqProducer = mockDeep<DLQProducerService>();
    orderIntegrationService = mockDeep<OrderIntegrationService>();
    providerFactory = mockDeep<PlatformProviderFactory>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookConsumerService,
        { provide: KafkaService, useValue: kafkaService },
        { provide: ConfigService, useValue: mockConfigEnabled },
        { provide: IdempotencyService, useValue: idempotencyService },
        { provide: DistributedLockService, useValue: lockService },
        { provide: DLQProducerService, useValue: dlqProducer },
        { provide: OrderIntegrationService, useValue: orderIntegrationService },
        { provide: PlatformProviderFactory, useValue: providerFactory },
      ],
    }).compile();

    service = module.get<WebhookConsumerService>(WebhookConsumerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should skip when kafka disabled', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookConsumerService,
          { provide: KafkaService, useValue: kafkaService },
          { provide: ConfigService, useValue: mockConfigDisabled },
          { provide: IdempotencyService, useValue: idempotencyService },
          { provide: DistributedLockService, useValue: lockService },
          { provide: DLQProducerService, useValue: dlqProducer },
          { provide: OrderIntegrationService, useValue: orderIntegrationService },
          { provide: PlatformProviderFactory, useValue: providerFactory },
        ],
      }).compile();

      const disabledService = module.get<WebhookConsumerService>(WebhookConsumerService);
      await disabledService.onModuleInit();

      expect(kafkaService.createConsumer).not.toHaveBeenCalled();
    });

    it('should create consumer with correct topics and group', async () => {
      kafkaService.createConsumer.mockResolvedValue({} as any);

      await service.onModuleInit();

      expect(kafkaService.createConsumer).toHaveBeenCalledWith(
        'webhook-processors',
        ['platform-webhooks'],
        expect.any(Function),
      );
    });

    it('should handle consumer creation failure gracefully', async () => {
      kafkaService.createConsumer.mockRejectedValue(new Error('Consumer failed'));

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('handleMessage', () => {
    const webhookEvent = mockWebhookReceivedEvent();
    const envelope = mockKafkaEnvelope(webhookEvent, {
      correlationId: 'corr-123',
      tenantId: 'tenant-1',
      retryCount: 0,
    });

    beforeEach(() => {
      kafkaService.parseMessage.mockReturnValue(envelope);
      idempotencyService.generateWebhookKey.mockReturnValue('tenant-1:GETIR:getir-12345:ORDER_CREATED');
    });

    it('should skip duplicate messages via idempotency check', async () => {
      idempotencyService.isDuplicate.mockResolvedValue(true);

      const payload = mockKafkaMessage({
        value: JSON.stringify(envelope),
        key: 'test-key',
      });

      await (service as any).handleMessage(payload);

      expect(lockService.withLock).not.toHaveBeenCalled();
      expect(orderIntegrationService.processIncomingOrder).not.toHaveBeenCalled();
    });

    it('should acquire distributed lock before processing', async () => {
      idempotencyService.isDuplicate.mockResolvedValue(false);
      lockService.withLock.mockResolvedValue({ acquired: true, result: { success: true } });

      const mockProvider = {
        parseWebhookPayload: jest.fn().mockReturnValue({ platformOrderId: 'getir-12345' }),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);

      const payload = mockKafkaMessage({
        value: JSON.stringify(envelope),
        key: 'test-key',
      });

      await (service as any).handleMessage(payload);

      expect(lockService.withLock).toHaveBeenCalledWith(
        'order:tenant-1:GETIR:getir-12345',
        expect.any(Function),
        { ttlMs: 30000 },
      );
    });

    it('should process ORDER_CREATED webhook', async () => {
      idempotencyService.isDuplicate.mockResolvedValue(false);

      const mockProvider = {
        parseWebhookPayload: jest.fn().mockReturnValue({ platformOrderId: 'getir-12345' }),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);
      orderIntegrationService.processIncomingOrder.mockResolvedValue({} as any);

      // Simulate withLock executing the callback
      lockService.withLock.mockImplementation(async (key, fn, opts) => {
        const result = await fn();
        return { acquired: true, result };
      });

      const payload = mockKafkaMessage({
        value: JSON.stringify(envelope),
        key: 'test-key',
      });

      await (service as any).handleMessage(payload);

      expect(orderIntegrationService.processIncomingOrder).toHaveBeenCalledWith(
        'tenant-1',
        'GETIR',
        expect.any(Object),
      );
    });

    it('should process ORDER_CANCELLED webhook', async () => {
      const cancelEvent = mockWebhookReceivedEvent({ webhookType: 'ORDER_CANCELLED' });
      const cancelEnvelope = mockKafkaEnvelope(cancelEvent, {
        correlationId: 'corr-123',
        tenantId: 'tenant-1',
      });

      kafkaService.parseMessage.mockReturnValue(cancelEnvelope);
      idempotencyService.isDuplicate.mockResolvedValue(false);
      idempotencyService.generateWebhookKey.mockReturnValue('tenant-1:GETIR:getir-12345:ORDER_CANCELLED');

      lockService.withLock.mockImplementation(async (key, fn, opts) => {
        const result = await fn();
        return { acquired: true, result };
      });

      const payload = mockKafkaMessage({
        value: JSON.stringify(cancelEnvelope),
        key: 'test-key',
      });

      await (service as any).handleMessage(payload);

      expect(orderIntegrationService.handleOrderCancellation).toHaveBeenCalledWith(
        'tenant-1',
        'GETIR',
        'getir-12345',
        expect.any(String),
      );
    });

    it('should process ORDER_UPDATED webhook', async () => {
      const updateEvent = mockWebhookReceivedEvent({
        webhookType: 'ORDER_UPDATED',
        rawPayload: { status: 'PREPARING' },
      });
      const updateEnvelope = mockKafkaEnvelope(updateEvent, {
        correlationId: 'corr-123',
        tenantId: 'tenant-1',
      });

      kafkaService.parseMessage.mockReturnValue(updateEnvelope);
      idempotencyService.isDuplicate.mockResolvedValue(false);

      lockService.withLock.mockImplementation(async (key, fn, opts) => {
        const result = await fn();
        return { acquired: true, result };
      });

      const payload = mockKafkaMessage({
        value: JSON.stringify(updateEnvelope),
        key: 'test-key',
      });

      await (service as any).handleMessage(payload);

      expect(orderIntegrationService.handleStatusUpdate).toHaveBeenCalledWith(
        'tenant-1',
        'GETIR',
        'getir-12345',
        'PREPARING',
      );
    });

    it('should requeue on lock contention when under retry limit', async () => {
      idempotencyService.isDuplicate.mockResolvedValue(false);
      lockService.withLock.mockResolvedValue({ acquired: false, result: null });
      kafkaService.produce.mockResolvedValue({} as any);

      const payload = mockKafkaMessage({
        value: JSON.stringify(envelope),
        key: 'test-key',
      });

      await (service as any).handleMessage(payload);

      expect(kafkaService.produce).toHaveBeenCalledWith(
        'platform-webhooks',
        expect.any(Object),
        expect.objectContaining({
          headers: expect.objectContaining({
            retryCount: '1',
          }),
        }),
      );
    });

    it('should send to DLQ when lock contention exceeds retry limit', async () => {
      const maxRetryEnvelope = mockKafkaEnvelope(webhookEvent, {
        correlationId: 'corr-123',
        tenantId: 'tenant-1',
        retryCount: 3,
      });

      kafkaService.parseMessage.mockReturnValue(maxRetryEnvelope);
      idempotencyService.isDuplicate.mockResolvedValue(false);
      lockService.withLock.mockResolvedValue({ acquired: false, result: null });

      const payload = mockKafkaMessage({
        value: JSON.stringify(maxRetryEnvelope),
        key: 'test-key',
      });

      await (service as any).handleMessage(payload);

      expect(dlqProducer.sendToDLQ).toHaveBeenCalledWith(
        'platform-webhooks',
        maxRetryEnvelope,
        expect.any(Error),
      );
    });

    it('should mark as processed after successful handling', async () => {
      idempotencyService.isDuplicate.mockResolvedValue(false);

      const mockProvider = {
        parseWebhookPayload: jest.fn().mockReturnValue({ platformOrderId: 'getir-12345' }),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);

      lockService.withLock.mockImplementation(async (key, fn, opts) => {
        const result = await fn();
        return { acquired: true, result };
      });

      const payload = mockKafkaMessage({
        value: JSON.stringify(envelope),
        key: 'test-key',
      });

      await (service as any).handleMessage(payload);

      expect(idempotencyService.markProcessed).toHaveBeenCalledWith(
        'tenant-1:GETIR:getir-12345:ORDER_CREATED',
        expect.objectContaining({
          correlationId: 'corr-123',
          result: 'SUCCESS',
        }),
      );
    });

    it('should return early for unparseable messages', async () => {
      kafkaService.parseMessage.mockReturnValue(null);

      const payload = mockKafkaMessage({
        value: 'invalid-json',
        key: 'test-key',
      });

      await (service as any).handleMessage(payload);

      expect(idempotencyService.isDuplicate).not.toHaveBeenCalled();
      expect(lockService.withLock).not.toHaveBeenCalled();
    });

    it('should log warning for unknown webhook types', async () => {
      const unknownEvent = mockWebhookReceivedEvent({ webhookType: 'UNKNOWN_TYPE' as any });
      const unknownEnvelope = mockKafkaEnvelope(unknownEvent, {
        correlationId: 'corr-123',
        tenantId: 'tenant-1',
      });

      kafkaService.parseMessage.mockReturnValue(unknownEnvelope);
      idempotencyService.isDuplicate.mockResolvedValue(false);

      lockService.withLock.mockImplementation(async (key, fn, opts) => {
        const result = await fn();
        return { acquired: true, result };
      });

      const payload = mockKafkaMessage({
        value: JSON.stringify(unknownEnvelope),
        key: 'test-key',
      });

      // Should not throw
      await expect((service as any).handleMessage(payload)).resolves.not.toThrow();
    });
  });
});
