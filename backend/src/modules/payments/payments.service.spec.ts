import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { mockPrismaClient, mockPayment, mockOrder } from '../../common/test/prisma-mock.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: ReturnType<typeof mockPrismaClient>;

  beforeEach(async () => {
    prisma = mockPrismaClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processPayment', () => {
    it('should process cash payment successfully', async () => {
      const paymentDto = {
        orderId: 'order-1',
        amount: 50.0,
        method: 'CASH',
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder as any);
      prisma.payment.create.mockResolvedValue({
        ...mockPayment,
        ...paymentDto,
        status: 'COMPLETED',
      } as any);
      prisma.order.update.mockResolvedValue({
        ...mockOrder,
        status: 'PAID',
      } as any);

      const result = await service.processPayment('tenant-1', paymentDto as any);

      expect(result.status).toBe('COMPLETED');
      expect(prisma.payment.create).toHaveBeenCalled();
      expect(prisma.order.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when order not found', async () => {
      const paymentDto = {
        orderId: 'invalid-order',
        amount: 50.0,
        method: 'CASH',
      };

      prisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.processPayment('tenant-1', paymentDto as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when amount does not match order', async () => {
      const paymentDto = {
        orderId: 'order-1',
        amount: 100.0, // Wrong amount
        method: 'CASH',
      };

      prisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        finalAmount: 50.0,
      } as any);

      await expect(
        service.processPayment('tenant-1', paymentDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when order already paid', async () => {
      const paymentDto = {
        orderId: 'order-1',
        amount: 50.0,
        method: 'CASH',
      };

      prisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        status: 'PAID',
      } as any);

      await expect(
        service.processPayment('tenant-1', paymentDto as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getPaymentsByOrder', () => {
    it('should return all payments for an order', async () => {
      const mockPayments = [mockPayment];
      prisma.payment.findMany.mockResolvedValue(mockPayments as any);

      const result = await service.getPaymentsByOrder('order-1', 'tenant-1');

      expect(result).toEqual(mockPayments);
      expect(prisma.payment.findMany).toHaveBeenCalledWith({
        where: {
          orderId: 'order-1',
          order: { tenantId: 'tenant-1' },
        },
      });
    });
  });

  describe('refundPayment', () => {
    it('should refund a completed payment', async () => {
      const refundedPayment = {
        ...mockPayment,
        status: 'REFUNDED',
      };

      prisma.payment.findUnique.mockResolvedValue(mockPayment as any);
      prisma.payment.update.mockResolvedValue(refundedPayment as any);

      const result = await service.refundPayment('payment-1', 'tenant-1');

      expect(result.status).toBe('REFUNDED');
      expect(prisma.payment.update).toHaveBeenCalled();
    });

    it('should throw BadRequestException when payment already refunded', async () => {
      const refundedPayment = {
        ...mockPayment,
        status: 'REFUNDED',
      };

      prisma.payment.findUnique.mockResolvedValue(refundedPayment as any);

      await expect(
        service.refundPayment('payment-1', 'tenant-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
