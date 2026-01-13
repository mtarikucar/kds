import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetirWebhookController } from './getir-webhook.controller';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrderIntegrationService } from '../services/order-integration.service';
import { GetirProvider } from '../services/providers/getir.provider';
import { WebhookProducerService } from '../../kafka/producers/webhook-producer.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { GetirWebhookEvent, PlatformType } from '../constants';

describe('GetirWebhookController', () => {
  let controller: GetirWebhookController;
  let prisma: DeepMockProxy<PrismaService>;
  let orderIntegrationService: DeepMockProxy<OrderIntegrationService>;
  let getirProvider: DeepMockProxy<GetirProvider>;
  let webhookProducer: DeepMockProxy<WebhookProducerService>;

  const createModule = async (kafkaEnabled: boolean) => {
    prisma = mockDeep<PrismaService>();
    orderIntegrationService = mockDeep<OrderIntegrationService>();
    getirProvider = mockDeep<GetirProvider>();
    webhookProducer = mockDeep<WebhookProducerService>();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GetirWebhookController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'kafka.enabled') return kafkaEnabled;
              return defaultValue;
            }),
          },
        },
        { provide: OrderIntegrationService, useValue: orderIntegrationService },
        { provide: GetirProvider, useValue: getirProvider },
        { provide: WebhookProducerService, useValue: webhookProducer },
      ],
    }).compile();

    return module.get<GetirWebhookController>(GetirWebhookController);
  };

  beforeEach(async () => {
    controller = await createModule(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleWebhook', () => {
    it('should throw BadRequestException for invalid signature', async () => {
      getirProvider.verifyWebhook.mockReturnValue(false);

      await expect(
        controller.handleWebhook(
          { type: GetirWebhookEvent.ORDER_RECEIVED },
          {},
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for missing tenant ID', async () => {
      getirProvider.verifyWebhook.mockReturnValue(true);

      await expect(
        controller.handleWebhook(
          { type: GetirWebhookEvent.ORDER_RECEIVED },
          {},
        ),
      ).rejects.toThrow(BadRequestException);
    });

    describe('with Kafka disabled', () => {
      it('should process ORDER_RECEIVED event', async () => {
        getirProvider.verifyWebhook.mockReturnValue(true);
        getirProvider.parseWebhookPayload.mockReturnValue({
          platformOrderId: 'order-123',
        } as any);
        orderIntegrationService.processIncomingOrder.mockResolvedValue({} as any);

        const result = await controller.handleWebhook(
          { type: GetirWebhookEvent.ORDER_RECEIVED, orderId: 'order-123' },
          { 'x-tenant-id': 'tenant-1' },
        );

        expect(result.success).toBe(true);
        expect(orderIntegrationService.processIncomingOrder).toHaveBeenCalledWith(
          'tenant-1',
          PlatformType.GETIR,
          expect.any(Object),
        );
      });

      it('should process ORDER_CANCELLED event', async () => {
        getirProvider.verifyWebhook.mockReturnValue(true);

        const result = await controller.handleWebhook(
          {
            type: GetirWebhookEvent.ORDER_CANCELLED,
            orderId: 'order-123',
            reason: 'Customer cancelled',
          },
          { 'x-tenant-id': 'tenant-1' },
        );

        expect(result.success).toBe(true);
        expect(orderIntegrationService.handleOrderCancellation).toHaveBeenCalledWith(
          'tenant-1',
          PlatformType.GETIR,
          'order-123',
          'Customer cancelled',
        );
      });

      it('should process ORDER_STATUS_CHANGED event', async () => {
        getirProvider.verifyWebhook.mockReturnValue(true);

        const result = await controller.handleWebhook(
          {
            type: GetirWebhookEvent.ORDER_STATUS_CHANGED,
            orderId: 'order-123',
            status: 'PREPARING',
          },
          { 'x-tenant-id': 'tenant-1' },
        );

        expect(result.success).toBe(true);
        expect(orderIntegrationService.handleStatusUpdate).toHaveBeenCalledWith(
          'tenant-1',
          PlatformType.GETIR,
          'order-123',
          'PREPARING',
        );
      });

      it('should add to dead letter queue on error', async () => {
        getirProvider.verifyWebhook.mockReturnValue(true);
        getirProvider.parseWebhookPayload.mockReturnValue(null);
        prisma.webhookDeadLetter.create.mockResolvedValue({} as any);

        const result = await controller.handleWebhook(
          { type: GetirWebhookEvent.ORDER_RECEIVED, orderId: 'order-123' },
          { 'x-tenant-id': 'tenant-1' },
        );

        expect((result as any).queued).toBe(true);
        expect(prisma.webhookDeadLetter.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            platformType: PlatformType.GETIR,
            status: 'PENDING',
          }),
        });
      });
    });

    describe('with Kafka enabled', () => {
      beforeEach(async () => {
        controller = await createModule(true);
      });

      it('should route to Kafka when enabled', async () => {
        getirProvider.verifyWebhook.mockReturnValue(true);
        webhookProducer.isEnabled.mockReturnValue(true);
        webhookProducer.produce.mockResolvedValue({} as any);

        const result = await controller.handleWebhook(
          { type: GetirWebhookEvent.ORDER_RECEIVED, orderId: 'order-123' },
          { 'x-tenant-id': 'tenant-1' },
        );

        expect(result.success).toBe(true);
        expect((result as any).message).toContain('queued');
        expect(webhookProducer.produce).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: 'tenant-1',
            platformType: PlatformType.GETIR,
            platformOrderId: 'order-123',
            webhookType: 'ORDER_CREATED',
          }),
        );
      });

      it('should fallback to synchronous on Kafka error', async () => {
        getirProvider.verifyWebhook.mockReturnValue(true);
        getirProvider.parseWebhookPayload.mockReturnValue({
          platformOrderId: 'order-123',
        } as any);
        webhookProducer.isEnabled.mockReturnValue(true);
        webhookProducer.produce.mockRejectedValue(new Error('Kafka unavailable'));
        orderIntegrationService.processIncomingOrder.mockResolvedValue({} as any);

        const result = await controller.handleWebhook(
          { type: GetirWebhookEvent.ORDER_RECEIVED, orderId: 'order-123' },
          { 'x-tenant-id': 'tenant-1' },
        );

        expect(result.success).toBe(true);
        expect(orderIntegrationService.processIncomingOrder).toHaveBeenCalled();
      });
    });
  });
});
