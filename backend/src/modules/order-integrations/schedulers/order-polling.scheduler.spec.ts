import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderPollingScheduler } from './order-polling.scheduler';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformProviderFactory } from '../services/platform-provider.factory';
import { OrderIntegrationService } from '../services/order-integration.service';
import { WebhookProducerService } from '../../kafka/producers/webhook-producer.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PlatformType } from '../constants';

describe('OrderPollingScheduler', () => {
  let scheduler: OrderPollingScheduler;
  let prisma: DeepMockProxy<PrismaService>;
  let providerFactory: DeepMockProxy<PlatformProviderFactory>;
  let orderIntegrationService: DeepMockProxy<OrderIntegrationService>;
  let webhookProducer: DeepMockProxy<WebhookProducerService>;

  const createModule = async (kafkaEnabled: boolean) => {
    prisma = mockDeep<PrismaService>();
    providerFactory = mockDeep<PlatformProviderFactory>();
    orderIntegrationService = mockDeep<OrderIntegrationService>();
    webhookProducer = mockDeep<WebhookProducerService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderPollingScheduler,
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
        { provide: PlatformProviderFactory, useValue: providerFactory },
        { provide: OrderIntegrationService, useValue: orderIntegrationService },
        { provide: WebhookProducerService, useValue: webhookProducer },
      ],
    }).compile();

    return module.get<OrderPollingScheduler>(OrderPollingScheduler);
  };

  beforeEach(async () => {
    scheduler = await createModule(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('pollForNewOrders', () => {
    it('should get all enabled integration settings', async () => {
      prisma.integrationSettings.findMany.mockResolvedValue([]);

      await scheduler.pollForNewOrders();

      expect(prisma.integrationSettings.findMany).toHaveBeenCalledWith({
        where: {
          integrationType: 'DELIVERY_APP',
          isEnabled: true,
          isConfigured: true,
        },
      });
    });

    it('should skip platforms without enablePolling', async () => {
      prisma.integrationSettings.findMany.mockResolvedValue([
        {
          tenantId: 'tenant-1',
          provider: PlatformType.GETIR,
          config: { enablePolling: false },
        } as any,
      ]);

      await scheduler.pollForNewOrders();

      expect(providerFactory.getProviderForTenant).not.toHaveBeenCalled();
    });

    it('should poll each configured platform', async () => {
      prisma.integrationSettings.findMany.mockResolvedValue([
        {
          tenantId: 'tenant-1',
          provider: PlatformType.GETIR,
          config: { enablePolling: true },
        } as any,
      ]);

      const mockProvider = {
        fetchNewOrders: jest.fn().mockResolvedValue([]),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);
      prisma.integrationSettings.findFirst.mockResolvedValue({
        lastSyncedAt: new Date(),
      } as any);

      await scheduler.pollForNewOrders();

      expect(providerFactory.getProviderForTenant).toHaveBeenCalledWith(
        PlatformType.GETIR,
        'tenant-1',
      );
      expect(mockProvider.fetchNewOrders).toHaveBeenCalled();
    });

    it('should handle polling errors gracefully', async () => {
      prisma.integrationSettings.findMany.mockRejectedValue(new Error('DB error'));

      // Should not throw
      await expect(scheduler.pollForNewOrders()).resolves.not.toThrow();
    });
  });

  describe('pollPlatform', () => {
    it('should fetch orders since last poll', async () => {
      const lastPoll = new Date('2024-01-01');
      prisma.integrationSettings.findMany.mockResolvedValue([
        {
          tenantId: 'tenant-1',
          provider: PlatformType.GETIR,
          config: { enablePolling: true },
        } as any,
      ]);
      prisma.integrationSettings.findFirst.mockResolvedValue({
        lastSyncedAt: lastPoll,
      } as any);

      const mockProvider = {
        fetchNewOrders: jest.fn().mockResolvedValue([]),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);

      await scheduler.pollForNewOrders();

      expect(mockProvider.fetchNewOrders).toHaveBeenCalledWith(lastPoll);
    });

    it('should skip existing orders', async () => {
      prisma.integrationSettings.findMany.mockResolvedValue([
        {
          tenantId: 'tenant-1',
          provider: PlatformType.GETIR,
          config: { enablePolling: true },
        } as any,
      ]);
      prisma.integrationSettings.findFirst.mockResolvedValue({} as any);

      const mockOrder = { platformOrderId: 'order-123', platformStatus: 'NEW', rawData: {} };
      const mockProvider = {
        fetchNewOrders: jest.fn().mockResolvedValue([mockOrder]),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);

      // Order already exists
      prisma.platformOrder.findMany.mockResolvedValue([
        { platformOrderId: 'order-123', platformStatus: 'NEW' },
      ] as any);
      prisma.integrationSettings.updateMany.mockResolvedValue({} as any);

      await scheduler.pollForNewOrders();

      // Should not process as new
      expect(orderIntegrationService.processIncomingOrder).not.toHaveBeenCalled();
    });

    it('should update status for changed orders', async () => {
      prisma.integrationSettings.findMany.mockResolvedValue([
        {
          tenantId: 'tenant-1',
          provider: PlatformType.GETIR,
          config: { enablePolling: true },
        } as any,
      ]);
      prisma.integrationSettings.findFirst.mockResolvedValue({} as any);

      const mockOrder = { platformOrderId: 'order-123', platformStatus: 'PREPARING', rawData: {} };
      const mockProvider = {
        fetchNewOrders: jest.fn().mockResolvedValue([mockOrder]),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);

      // Order exists with different status
      prisma.platformOrder.findMany.mockResolvedValue([
        { id: 'po-1', platformOrderId: 'order-123', platformStatus: 'NEW' },
      ] as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);
      prisma.integrationSettings.updateMany.mockResolvedValue({} as any);

      await scheduler.pollForNewOrders();

      expect(prisma.platformOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        data: expect.objectContaining({
          platformStatus: 'PREPARING',
        }),
      });
    });

    it('should process new orders', async () => {
      prisma.integrationSettings.findMany.mockResolvedValue([
        {
          tenantId: 'tenant-1',
          provider: PlatformType.GETIR,
          config: { enablePolling: true },
        } as any,
      ]);
      prisma.integrationSettings.findFirst.mockResolvedValue({} as any);

      const mockOrder = {
        platformOrderId: 'new-order-123',
        platformStatus: 'NEW',
        rawData: { id: '123' },
      };
      const mockProvider = {
        fetchNewOrders: jest.fn().mockResolvedValue([mockOrder]),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);

      // No existing orders
      prisma.platformOrder.findMany.mockResolvedValue([]);
      prisma.integrationSettings.updateMany.mockResolvedValue({} as any);

      await scheduler.pollForNewOrders();

      expect(orderIntegrationService.processIncomingOrder).toHaveBeenCalledWith(
        'tenant-1',
        PlatformType.GETIR,
        mockOrder,
      );
    });

    it('should update last poll timestamp', async () => {
      prisma.integrationSettings.findMany.mockResolvedValue([
        {
          tenantId: 'tenant-1',
          provider: PlatformType.GETIR,
          config: { enablePolling: true },
        } as any,
      ]);
      prisma.integrationSettings.findFirst.mockResolvedValue({} as any);

      // Must return at least one order for updateLastPollTimestamp to be called
      const mockOrder = {
        platformOrderId: 'order-123',
        platformStatus: 'NEW',
        rawData: { id: '123' },
      };
      const mockProvider = {
        fetchNewOrders: jest.fn().mockResolvedValue([mockOrder]),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);
      prisma.platformOrder.findMany.mockResolvedValue([]);
      prisma.integrationSettings.updateMany.mockResolvedValue({} as any);

      await scheduler.pollForNewOrders();

      expect(prisma.integrationSettings.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          integrationType: 'DELIVERY_APP',
          provider: PlatformType.GETIR,
        },
        data: {
          lastSyncedAt: expect.any(Date),
        },
      });
    });
  });

  describe('processNewOrder', () => {
    describe('with Kafka enabled', () => {
      beforeEach(async () => {
        scheduler = await createModule(true);
      });

      it('should route through Kafka when enabled', async () => {
        prisma.integrationSettings.findMany.mockResolvedValue([
          {
            tenantId: 'tenant-1',
            provider: PlatformType.GETIR,
            config: { enablePolling: true },
          } as any,
        ]);
        prisma.integrationSettings.findFirst.mockResolvedValue({} as any);

        const mockOrder = {
          platformOrderId: 'new-order-123',
          platformStatus: 'NEW',
          rawData: { id: '123' },
        };
        const mockProvider = {
          fetchNewOrders: jest.fn().mockResolvedValue([mockOrder]),
        };
        providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);

        prisma.platformOrder.findMany.mockResolvedValue([]);
        prisma.integrationSettings.updateMany.mockResolvedValue({} as any);
        webhookProducer.isEnabled.mockReturnValue(true);
        webhookProducer.produce.mockResolvedValue({} as any);

        await scheduler.pollForNewOrders();

        expect(webhookProducer.produce).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: 'tenant-1',
            platformType: PlatformType.GETIR,
            webhookType: 'ORDER_CREATED',
          }),
        );
        expect(orderIntegrationService.processIncomingOrder).not.toHaveBeenCalled();
      });
    });

    describe('with Kafka disabled', () => {
      it('should use direct processing as fallback', async () => {
        prisma.integrationSettings.findMany.mockResolvedValue([
          {
            tenantId: 'tenant-1',
            provider: PlatformType.GETIR,
            config: { enablePolling: true },
          } as any,
        ]);
        prisma.integrationSettings.findFirst.mockResolvedValue({} as any);

        const mockOrder = {
          platformOrderId: 'new-order-123',
          platformStatus: 'NEW',
          rawData: { id: '123' },
        };
        const mockProvider = {
          fetchNewOrders: jest.fn().mockResolvedValue([mockOrder]),
        };
        providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);

        prisma.platformOrder.findMany.mockResolvedValue([]);
        prisma.integrationSettings.updateMany.mockResolvedValue({} as any);

        await scheduler.pollForNewOrders();

        expect(orderIntegrationService.processIncomingOrder).toHaveBeenCalled();
      });
    });
  });

  describe('syncOrderStatuses', () => {
    it('should fetch active orders from last 24 hours', async () => {
      prisma.platformOrder.findMany.mockResolvedValue([]);

      await scheduler.syncOrderStatuses();

      expect(prisma.platformOrder.findMany).toHaveBeenCalledWith({
        where: {
          internalStatus: { in: ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY'] },
          createdAt: { gte: expect.any(Date) },
        },
        include: { order: true },
      });
    });

    it('should skip orders without internal order link', async () => {
      prisma.platformOrder.findMany.mockResolvedValue([
        { id: 'po-1', order: null, platformType: PlatformType.GETIR },
      ] as any);

      await scheduler.syncOrderStatuses();

      expect(providerFactory.getProviderForTenant).not.toHaveBeenCalled();
    });

    it('should update status when changed', async () => {
      prisma.platformOrder.findMany.mockResolvedValue([
        {
          id: 'po-1',
          tenantId: 'tenant-1',
          platformOrderId: 'order-123',
          platformType: PlatformType.GETIR,
          platformStatus: 'NEW',
          order: { id: 'order-1' },
        },
      ] as any);

      const mockProvider = {
        getOrderStatus: jest.fn().mockResolvedValue('PREPARING'),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);

      await scheduler.syncOrderStatuses();

      expect(prisma.platformOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        data: {
          platformStatus: 'PREPARING',
          updatedAt: expect.any(Date),
        },
      });
    });

    it('should handle sync errors gracefully', async () => {
      prisma.platformOrder.findMany.mockRejectedValue(new Error('DB error'));

      // Should not throw
      await expect(scheduler.syncOrderStatuses()).resolves.not.toThrow();
    });
  });
});
