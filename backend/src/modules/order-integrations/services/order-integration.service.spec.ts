import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { OrderIntegrationService } from './order-integration.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { KdsGateway } from '../../kds/kds.gateway';
import { OrdersService } from '../../orders/services/orders.service';
import { PlatformProviderFactory } from './platform-provider.factory';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PlatformType, PlatformOrderStatus } from '../constants';
import {
  mockPlatformOrder,
  mockIntegrationSettings,
  mockProductMapping,
} from '../../../common/test/platform-order-mock';

describe('OrderIntegrationService', () => {
  let service: OrderIntegrationService;
  let prisma: DeepMockProxy<PrismaService>;
  let kdsGateway: DeepMockProxy<KdsGateway>;
  let ordersService: DeepMockProxy<OrdersService>;
  let providerFactory: DeepMockProxy<PlatformProviderFactory>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    kdsGateway = mockDeep<KdsGateway>();
    ordersService = mockDeep<OrdersService>();
    providerFactory = mockDeep<PlatformProviderFactory>();

    // Setup mock gateway server
    kdsGateway.server = {
      to: jest.fn().mockReturnValue({
        emit: jest.fn(),
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderIntegrationService,
        { provide: PrismaService, useValue: prisma },
        { provide: KdsGateway, useValue: kdsGateway },
        { provide: OrdersService, useValue: ordersService },
        { provide: PlatformProviderFactory, useValue: providerFactory },
      ],
    }).compile();

    service = module.get<OrderIntegrationService>(OrderIntegrationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processIncomingOrder', () => {
    const orderData = {
      platformOrderId: 'getir-12345',
      platformOrderNumber: 'GY-001',
      platformStatus: 'NEW',
      customerName: 'John Doe',
      customerPhone: '+905551234567',
      deliveryAddress: '123 Test St',
      total: 99.99,
      createdAt: new Date(),
      rawData: {},
    };

    it('should return existing order if already processed', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(mockPlatformOrder as any);

      const result = await service.processIncomingOrder(
        'tenant-1',
        PlatformType.GETIR,
        orderData as any,
      );

      expect(result).toEqual(mockPlatformOrder);
      expect(prisma.platformOrder.create).not.toHaveBeenCalled();
    });

    it('should create platform order with correct data mapping', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(null);
      prisma.platformOrder.create.mockResolvedValue(mockPlatformOrder as any);
      prisma.integrationSettings.findFirst.mockResolvedValue(null);
      prisma.integrationSyncLog.create.mockResolvedValue({} as any);

      await service.processIncomingOrder(
        'tenant-1',
        PlatformType.GETIR,
        orderData as any,
      );

      expect(prisma.platformOrder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          platformType: PlatformType.GETIR,
          platformOrderId: 'getir-12345',
          internalStatus: 'RECEIVED',
        }),
      });
    });

    it('should auto-accept when autoAccept setting enabled', async () => {
      prisma.platformOrder.findFirst
        .mockResolvedValueOnce(null) // First call - order doesn't exist
        .mockResolvedValueOnce(mockPlatformOrder as any); // Second call - for acceptPlatformOrder

      prisma.platformOrder.create.mockResolvedValue(mockPlatformOrder as any);
      prisma.integrationSettings.findFirst.mockResolvedValue({
        config: { autoAccept: true, defaultPrepTime: 30 },
      } as any);
      prisma.integrationSyncLog.create.mockResolvedValue({} as any);

      const mockProvider = {
        acceptOrder: jest.fn().mockResolvedValue({ success: true }),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);
      ordersService.create.mockResolvedValue({ id: 'order-1' } as any);
      prisma.order.update.mockResolvedValue({} as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);

      await service.processIncomingOrder(
        'tenant-1',
        PlatformType.GETIR,
        orderData as any,
      );

      expect(mockProvider.acceptOrder).toHaveBeenCalled();
    });

    it('should emit WebSocket event for KDS', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(null);
      prisma.platformOrder.create.mockResolvedValue(mockPlatformOrder as any);
      prisma.integrationSettings.findFirst.mockResolvedValue(null);
      prisma.integrationSyncLog.create.mockResolvedValue({} as any);

      await service.processIncomingOrder(
        'tenant-1',
        PlatformType.GETIR,
        orderData as any,
      );

      expect(kdsGateway.server.to).toHaveBeenCalledWith('kitchen-tenant-1');
    });

    it('should log successful sync', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(null);
      prisma.platformOrder.create.mockResolvedValue(mockPlatformOrder as any);
      prisma.integrationSettings.findFirst.mockResolvedValue(null);
      prisma.integrationSyncLog.create.mockResolvedValue({} as any);

      await service.processIncomingOrder(
        'tenant-1',
        PlatformType.GETIR,
        orderData as any,
      );

      expect(prisma.integrationSyncLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'SUCCESS',
          operationType: 'ORDER_RECEIVED',
          direction: 'INBOUND',
        }),
      });
    });

    it('should log failed sync on error', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(null);
      prisma.platformOrder.create.mockRejectedValue(new Error('DB error'));
      prisma.integrationSyncLog.create.mockResolvedValue({} as any);

      await expect(
        service.processIncomingOrder('tenant-1', PlatformType.GETIR, orderData as any),
      ).rejects.toThrow('DB error');

      expect(prisma.integrationSyncLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'DB error',
        }),
      });
    });
  });

  describe('acceptPlatformOrder', () => {
    it('should throw NotFoundException when order not found', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.acceptPlatformOrder('order-1', 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when already accepted', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue({
        ...mockPlatformOrder,
        orderId: 'existing-order',
      } as any);

      await expect(
        service.acceptPlatformOrder('order-1', 'tenant-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept order on platform via provider', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(mockPlatformOrder as any);
      prisma.integrationSettings.findFirst.mockResolvedValue({
        config: { defaultPrepTime: 25 },
      } as any);

      const mockProvider = {
        acceptOrder: jest.fn().mockResolvedValue({ success: true }),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);

      ordersService.create.mockResolvedValue({ id: 'order-1' } as any);
      prisma.order.update.mockResolvedValue({} as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);
      prisma.platformProductMapping.findFirst.mockResolvedValue(null);

      await service.acceptPlatformOrder('platform-order-1', 'tenant-1');

      expect(mockProvider.acceptOrder).toHaveBeenCalledWith('getir-12345', 25);
    });

    it('should create internal order with mapped items', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue({
        ...mockPlatformOrder,
        rawOrderData: { items: [{ platformProductId: 'p1', quantity: 2, unitPrice: 10 }] },
      } as any);
      prisma.integrationSettings.findFirst.mockResolvedValue({ config: {} } as any);

      const mockProvider = {
        acceptOrder: jest.fn().mockResolvedValue({ success: true }),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);

      prisma.platformProductMapping.findFirst.mockResolvedValue({
        productId: 'internal-product-1',
      } as any);

      ordersService.create.mockResolvedValue({ id: 'order-1' } as any);
      prisma.order.update.mockResolvedValue({} as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);

      await service.acceptPlatformOrder('platform-order-1', 'tenant-1');

      expect(ordersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'DELIVERY',
          items: expect.arrayContaining([
            expect.objectContaining({ productId: 'internal-product-1' }),
          ]),
        }),
        null,
        'tenant-1',
      );
    });

    it('should update platform order with internal order reference', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(mockPlatformOrder as any);
      prisma.integrationSettings.findFirst.mockResolvedValue({ config: {} } as any);

      const mockProvider = {
        acceptOrder: jest.fn().mockResolvedValue({ success: true }),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);

      ordersService.create.mockResolvedValue({ id: 'internal-order-1' } as any);
      prisma.order.update.mockResolvedValue({} as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);
      prisma.platformProductMapping.findFirst.mockResolvedValue(null);

      await service.acceptPlatformOrder('platform-order-1', 'tenant-1');

      expect(prisma.platformOrder.update).toHaveBeenCalledWith({
        where: { id: 'platform-order-1' },
        data: expect.objectContaining({
          orderId: 'internal-order-1',
          internalStatus: 'PENDING',
        }),
      });
    });

    it('should emit to KDS gateway', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(mockPlatformOrder as any);
      prisma.integrationSettings.findFirst.mockResolvedValue({ config: {} } as any);

      const mockProvider = {
        acceptOrder: jest.fn().mockResolvedValue({ success: true }),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);

      ordersService.create.mockResolvedValue({ id: 'order-1' } as any);
      prisma.order.update.mockResolvedValue({} as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);
      prisma.platformProductMapping.findFirst.mockResolvedValue(null);

      await service.acceptPlatformOrder('platform-order-1', 'tenant-1');

      expect(kdsGateway.emitNewOrder).toHaveBeenCalledWith('tenant-1', expect.any(Object));
    });
  });

  describe('rejectPlatformOrder', () => {
    it('should throw NotFoundException when order not found', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.rejectPlatformOrder('order-1', 'tenant-1', 'Out of stock'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject order on platform via provider', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(mockPlatformOrder as any);

      const mockProvider = {
        rejectOrder: jest.fn().mockResolvedValue({ success: true }),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);

      await service.rejectPlatformOrder('order-1', 'tenant-1', 'Out of stock');

      expect(mockProvider.rejectOrder).toHaveBeenCalledWith('getir-12345', 'Out of stock');
    });

    it('should update platform order status', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(mockPlatformOrder as any);

      const mockProvider = {
        rejectOrder: jest.fn().mockResolvedValue({ success: true }),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);

      await service.rejectPlatformOrder('order-1', 'tenant-1', 'Out of stock');

      expect(prisma.platformOrder.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: expect.objectContaining({
          internalStatus: PlatformOrderStatus.REJECTED,
          platformStatus: 'REJECTED',
          cancellationReason: 'Out of stock',
        }),
      });
    });
  });

  describe('handleOrderCancellation', () => {
    it('should log warning when order not found', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(null);

      await service.handleOrderCancellation(
        'tenant-1',
        PlatformType.GETIR,
        'order-123',
        'Customer cancelled',
      );

      expect(prisma.platformOrder.update).not.toHaveBeenCalled();
    });

    it('should update platform order to CANCELLED', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(mockPlatformOrder as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);
      prisma.integrationSyncLog.create.mockResolvedValue({} as any);

      await service.handleOrderCancellation(
        'tenant-1',
        PlatformType.GETIR,
        'getir-12345',
        'Customer cancelled',
      );

      expect(prisma.platformOrder.update).toHaveBeenCalledWith({
        where: { id: mockPlatformOrder.id },
        data: expect.objectContaining({
          internalStatus: PlatformOrderStatus.CANCELLED,
          platformStatus: 'CANCELLED',
          cancellationReason: 'Customer cancelled',
        }),
      });
    });

    it('should cancel linked internal order', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue({
        ...mockPlatformOrder,
        orderId: 'internal-order-1',
      } as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);
      prisma.order.update.mockResolvedValue({} as any);
      prisma.integrationSyncLog.create.mockResolvedValue({} as any);

      await service.handleOrderCancellation(
        'tenant-1',
        PlatformType.GETIR,
        'getir-12345',
        'Customer cancelled',
      );

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'internal-order-1' },
        data: { status: 'CANCELLED' },
      });
    });

    it('should emit cancellation event', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue({
        ...mockPlatformOrder,
        orderId: 'internal-order-1',
      } as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);
      prisma.order.update.mockResolvedValue({} as any);
      prisma.integrationSyncLog.create.mockResolvedValue({} as any);

      await service.handleOrderCancellation(
        'tenant-1',
        PlatformType.GETIR,
        'getir-12345',
        'Customer cancelled',
      );

      expect(kdsGateway.server.to).toHaveBeenCalledWith('kitchen-tenant-1');
    });
  });

  describe('handleStatusUpdate', () => {
    it('should log warning when order not found', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(null);

      await service.handleStatusUpdate(
        'tenant-1',
        PlatformType.GETIR,
        'order-123',
        'PREPARING',
      );

      expect(prisma.platformOrder.update).not.toHaveBeenCalled();
    });

    it('should map platform status to internal status', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(mockPlatformOrder as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);
      prisma.integrationSyncLog.create.mockResolvedValue({} as any);

      await service.handleStatusUpdate(
        'tenant-1',
        PlatformType.GETIR,
        'getir-12345',
        'PREPARING',
      );

      expect(prisma.platformOrder.update).toHaveBeenCalledWith({
        where: { id: mockPlatformOrder.id },
        data: expect.objectContaining({
          platformStatus: 'PREPARING',
          internalStatus: PlatformOrderStatus.PREPARING,
        }),
      });
    });

    it('should update internal order for significant status changes', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue({
        ...mockPlatformOrder,
        orderId: 'internal-order-1',
      } as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);
      prisma.order.update.mockResolvedValue({} as any);
      prisma.integrationSyncLog.create.mockResolvedValue({} as any);

      await service.handleStatusUpdate(
        'tenant-1',
        PlatformType.GETIR,
        'getir-12345',
        'DELIVERED',
      );

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'internal-order-1' },
        data: { status: 'SERVED' },
      });
    });

    it('should emit status change event', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue({
        ...mockPlatformOrder,
        orderId: 'internal-order-1',
      } as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);
      prisma.order.update.mockResolvedValue({} as any);
      prisma.integrationSyncLog.create.mockResolvedValue({} as any);

      await service.handleStatusUpdate(
        'tenant-1',
        PlatformType.GETIR,
        'getir-12345',
        'DELIVERED',
      );

      expect(kdsGateway.emitOrderStatusChange).toHaveBeenCalled();
    });
  });

  describe('pushStatusUpdate', () => {
    it('should skip non-platform orders', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'order-1' } as any);

      await service.pushStatusUpdate('order-1', 'tenant-1', 'PREPARING');

      expect(providerFactory.getProviderForTenant).not.toHaveBeenCalled();
    });

    it('should push status to platform via provider', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        platformOrder: mockPlatformOrder,
      } as any);

      const mockProvider = {
        updateOrderStatus: jest.fn().mockResolvedValue({ success: true }),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);

      await service.pushStatusUpdate('order-1', 'tenant-1', 'PREPARING');

      expect(mockProvider.updateOrderStatus).toHaveBeenCalledWith(
        'getir-12345',
        PlatformOrderStatus.PREPARING,
      );
    });

    it('should update platform order record', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'order-1',
        platformOrder: mockPlatformOrder,
      } as any);

      const mockProvider = {
        updateOrderStatus: jest.fn().mockResolvedValue({ success: true }),
      };
      providerFactory.getProviderForTenant.mockResolvedValue(mockProvider as any);
      prisma.platformOrder.update.mockResolvedValue({} as any);

      await service.pushStatusUpdate('order-1', 'tenant-1', 'READY');

      expect(prisma.platformOrder.update).toHaveBeenCalledWith({
        where: { id: mockPlatformOrder.id },
        data: expect.objectContaining({
          internalStatus: 'READY',
          readyAt: expect.any(Date),
        }),
      });
    });
  });

  describe('getPlatformOrders', () => {
    it('should return paginated orders with filters', async () => {
      const orders = [mockPlatformOrder];
      prisma.platformOrder.findMany.mockResolvedValue(orders as any);
      prisma.platformOrder.count.mockResolvedValue(1);

      const result = await service.getPlatformOrders('tenant-1', {
        limit: 10,
        offset: 0,
      });

      expect(result.orders).toEqual(orders);
      expect(result.total).toBe(1);
    });

    it('should filter by platformType', async () => {
      prisma.platformOrder.findMany.mockResolvedValue([]);
      prisma.platformOrder.count.mockResolvedValue(0);

      await service.getPlatformOrders('tenant-1', {
        platformType: PlatformType.GETIR,
      });

      expect(prisma.platformOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            platformType: PlatformType.GETIR,
          }),
        }),
      );
    });

    it('should filter by status', async () => {
      prisma.platformOrder.findMany.mockResolvedValue([]);
      prisma.platformOrder.count.mockResolvedValue(0);

      await service.getPlatformOrders('tenant-1', {
        status: 'RECEIVED,ACCEPTED',
      });

      expect(prisma.platformOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            internalStatus: { in: ['RECEIVED', 'ACCEPTED'] },
          }),
        }),
      );
    });

    it('should filter by date range', async () => {
      prisma.platformOrder.findMany.mockResolvedValue([]);
      prisma.platformOrder.count.mockResolvedValue(0);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      await service.getPlatformOrders('tenant-1', { startDate, endDate });

      expect(prisma.platformOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: startDate,
              lte: endDate,
            },
          }),
        }),
      );
    });
  });

  describe('getPlatformOrder', () => {
    it('should return order with items', async () => {
      const orderWithItems = {
        ...mockPlatformOrder,
        order: { orderItems: [] },
      };
      prisma.platformOrder.findFirst.mockResolvedValue(orderWithItems as any);

      const result = await service.getPlatformOrder('order-1', 'tenant-1');

      expect(result).toEqual(orderWithItems);
    });

    it('should throw NotFoundException when not found', async () => {
      prisma.platformOrder.findFirst.mockResolvedValue(null);

      await expect(
        service.getPlatformOrder('invalid-id', 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
