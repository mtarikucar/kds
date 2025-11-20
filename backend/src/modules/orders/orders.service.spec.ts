import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { mockPrismaClient, mockOrder, mockProduct } from '../../common/test/prisma-mock.service';
import { OrderStatus, OrderType } from '@prisma/client';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: ReturnType<typeof mockPrismaClient>;

  beforeEach(async () => {
    prisma = mockPrismaClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new order with items', async () => {
      const createDto = {
        type: OrderType.DINE_IN,
        tableId: 'table-1',
        items: [
          { productId: 'product-1', quantity: 2, price: 10.99 },
        ],
      };

      const createdOrder = {
        ...mockOrder,
        ...createDto,
        totalAmount: 21.98,
        finalAmount: 21.98,
      };

      prisma.product.findMany.mockResolvedValue([mockProduct]);
      prisma.order.create.mockResolvedValue(createdOrder);

      const result = await service.create('tenant-1', createDto);

      expect(result).toEqual(createdOrder);
      expect(prisma.order.create).toHaveBeenCalled();
    });

    it('should apply discount to order total', async () => {
      const createDto = {
        type: OrderType.TAKEAWAY,
        items: [
          { productId: 'product-1', quantity: 1, price: 100 },
        ],
        discount: 10, // 10% discount
      };

      prisma.product.findMany.mockResolvedValue([mockProduct]);
      prisma.order.create.mockResolvedValue({
        ...mockOrder,
        totalAmount: 100,
        discount: 10,
        finalAmount: 90,
      });

      const result = await service.create('tenant-1', createDto);

      expect(result.finalAmount).toBe(90);
    });
  });

  describe('updateStatus', () => {
    it('should update order status', async () => {
      const updatedOrder = {
        ...mockOrder,
        status: OrderStatus.PREPARING,
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.order.update.mockResolvedValue(updatedOrder);

      const result = await service.updateStatus(
        'order-1',
        'tenant-1',
        OrderStatus.PREPARING,
      );

      expect(result.status).toBe(OrderStatus.PREPARING);
      expect(prisma.order.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when order not found', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus('invalid-id', 'tenant-1', OrderStatus.PREPARING),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return paginated orders for tenant', async () => {
      const mockOrders = [mockOrder];
      prisma.order.findMany.mockResolvedValue(mockOrders);
      prisma.order.count.mockResolvedValue(1);

      const result = await service.findAll('tenant-1', {
        page: 1,
        limit: 20,
      });

      expect(result.data).toEqual(mockOrders);
      expect(result.total).toBe(1);
    });

    it('should filter orders by status', async () => {
      const mockOrders = [mockOrder];
      prisma.order.findMany.mockResolvedValue(mockOrders);
      prisma.order.count.mockResolvedValue(1);

      await service.findAll('tenant-1', {
        page: 1,
        limit: 20,
        status: OrderStatus.PENDING,
      });

      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: OrderStatus.PENDING,
          }),
        }),
      );
    });
  });

  describe('cancel', () => {
    it('should cancel an order', async () => {
      const cancelledOrder = {
        ...mockOrder,
        status: OrderStatus.CANCELLED,
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.order.update.mockResolvedValue(cancelledOrder);

      const result = await service.cancel('order-1', 'tenant-1');

      expect(result.status).toBe(OrderStatus.CANCELLED);
    });

    it('should throw BadRequestException when order already paid', async () => {
      const paidOrder = {
        ...mockOrder,
        status: OrderStatus.PAID,
      };

      prisma.order.findUnique.mockResolvedValue(paidOrder);

      await expect(
        service.cancel('order-1', 'tenant-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
