import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { GetirProvider } from './getir.provider';
import { PrismaService } from '../../../../prisma/prisma.service';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PlatformType, PlatformOrderStatus } from '../../constants';
import * as crypto from 'crypto';

describe('GetirProvider', () => {
  let provider: GetirProvider;
  let prisma: DeepMockProxy<PrismaService>;
  let httpService: DeepMockProxy<HttpService>;
  let configService: DeepMockProxy<ConfigService>;
  let mockAxiosRef: { request: jest.Mock };

  const mockCredentials = {
    apiKey: 'test-api-key',
    restaurantId: 'restaurant-123',
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    httpService = mockDeep<HttpService>();
    configService = mockDeep<ConfigService>();

    // Mock axiosRef.request
    mockAxiosRef = {
      request: jest.fn(),
    };
    (httpService as any).axiosRef = mockAxiosRef;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GetirProvider,
        { provide: PrismaService, useValue: prisma },
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    provider = module.get<GetirProvider>(GetirProvider);

    // Mock credentials lookup
    prisma.integrationSettings.findFirst.mockResolvedValue({
      config: mockCredentials,
    } as any);
    prisma.integrationSyncLog.create.mockResolvedValue({} as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('acceptOrder', () => {
    it('should call Getir API with prep time', async () => {
      mockAxiosRef.request.mockResolvedValue({ data: {}, status: 200 });
      await provider.initialize('tenant-1');

      const result = await provider.acceptOrder('order-123', 30);

      expect(result.success).toBe(true);
      expect(result.estimatedPrepTime).toBe(30);
      expect(mockAxiosRef.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: expect.stringContaining('/orders/order-123/accept'),
          data: { preparationTime: 30 },
        }),
      );
    });

    it('should use default prep time of 25 minutes', async () => {
      mockAxiosRef.request.mockResolvedValue({ data: {}, status: 200 });
      await provider.initialize('tenant-1');

      await provider.acceptOrder('order-123');

      expect(mockAxiosRef.request).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { preparationTime: 25 },
        }),
      );
    });

    it('should log sync operation', async () => {
      mockAxiosRef.request.mockResolvedValue({ data: {}, status: 200 });
      await provider.initialize('tenant-1');

      await provider.acceptOrder('order-123', 30);

      expect(prisma.integrationSyncLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'SUCCESS',
          operationType: 'ORDER_STATUS_PUSH',
        }),
      });
    });

    it('should return failure result on API error', async () => {
      mockAxiosRef.request.mockRejectedValue(new Error('API Error'));
      await provider.initialize('tenant-1');

      const result = await provider.acceptOrder('order-123', 30);

      expect(result.success).toBe(false);
      expect(result.message).toBe('API Error');
    });
  });

  describe('rejectOrder', () => {
    it('should call Getir API with rejection reason', async () => {
      mockAxiosRef.request.mockResolvedValue({ data: {}, status: 200 });
      await provider.initialize('tenant-1');

      const result = await provider.rejectOrder('order-123', 'Out of stock');

      expect(result.success).toBe(true);
      expect(mockAxiosRef.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: expect.stringContaining('/orders/order-123/reject'),
          data: { rejectReason: 'Out of stock' },
        }),
      );
    });

    it('should return failure on API error', async () => {
      mockAxiosRef.request.mockRejectedValue(new Error('Reject failed'));
      await provider.initialize('tenant-1');

      const result = await provider.rejectOrder('order-123', 'Reason');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Reject failed');
    });
  });

  describe('updateOrderStatus', () => {
    it('should map internal status to Getir status', async () => {
      mockAxiosRef.request.mockResolvedValue({ data: {}, status: 200 });
      await provider.initialize('tenant-1');

      const result = await provider.updateOrderStatus(
        'order-123',
        PlatformOrderStatus.PREPARING,
      );

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('PREPARING');
    });

    it('should return failure for unsupported statuses', async () => {
      await provider.initialize('tenant-1');

      const result = await provider.updateOrderStatus(
        'order-123',
        PlatformOrderStatus.RECEIVED,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('not supported');
    });

    it('should handle API error', async () => {
      mockAxiosRef.request.mockRejectedValue(new Error('Status update failed'));
      await provider.initialize('tenant-1');

      const result = await provider.updateOrderStatus(
        'order-123',
        PlatformOrderStatus.PREPARING,
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe('Status update failed');
    });
  });

  describe('syncMenu', () => {
    const mockProducts = [
      {
        productId: 'p1',
        name: 'Test Product',
        description: 'Test',
        price: 25.0,
        categoryId: 'cat1',
        isAvailable: true,
      },
    ];

    it('should convert prices to kuruş', async () => {
      mockAxiosRef.request.mockResolvedValue({ data: {}, status: 200 });
      await provider.initialize('tenant-1');

      await provider.syncMenu(mockProducts as any, []);

      expect(mockAxiosRef.request).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            products: expect.arrayContaining([
              expect.objectContaining({
                price: 2500, // 25.00 * 100
              }),
            ]),
          }),
        }),
      );
    });

    it('should sync all products', async () => {
      mockAxiosRef.request.mockResolvedValue({ data: {}, status: 200 });
      await provider.initialize('tenant-1');

      const result = await provider.syncMenu(mockProducts as any, []);

      expect(result.success).toBe(true);
      expect(result.syncedProducts).toBe(1);
      expect(result.failedProducts).toBe(0);
    });

    it('should return error count on failure', async () => {
      mockAxiosRef.request.mockRejectedValue(new Error('Sync failed'));
      await provider.initialize('tenant-1');

      const result = await provider.syncMenu(mockProducts as any, []);

      expect(result.success).toBe(false);
      expect(result.failedProducts).toBe(1);
      expect(result.errors).toBeDefined();
    });
  });

  describe('fetchNewOrders', () => {
    it('should return transformed orders', async () => {
      const mockOrder = {
        id: 'getir-123',
        orderNo: 'GY-001',
        status: 'NEW',
        client: {
          name: 'John Doe',
          phone: '+905551234567',
          deliveryAddress: { address: '123 Test St' },
        },
        products: [
          {
            id: 'p1',
            name: 'Product 1',
            count: 2,
            price: 2500,
            totalPrice: 5000,
          },
        ],
        totalPrice: 9999,
        paymentMethodId: 1,
        isPaid: true,
        createdAt: '2024-01-01T12:00:00Z',
      };

      mockAxiosRef.request.mockResolvedValue({ data: { orders: [mockOrder] }, status: 200 });
      await provider.initialize('tenant-1');

      const result = await provider.fetchNewOrders();

      expect(result).toHaveLength(1);
      expect(result[0].platformOrderId).toBe('getir-123');
      expect(result[0].customerName).toBe('John Doe');
      expect(result[0].total).toBe(99.99); // Converted from kuruş
    });

    it('should return empty array on error', async () => {
      mockAxiosRef.request.mockRejectedValue(new Error('Fetch failed'));
      await provider.initialize('tenant-1');

      const result = await provider.fetchNewOrders();

      expect(result).toEqual([]);
    });
  });

  describe('verifyWebhook', () => {
    const webhookSecret = 'test-secret';

    beforeEach(() => {
      configService.get.mockReturnValue(webhookSecret);
    });

    it('should verify HMAC signature', () => {
      const payload = { type: 'ORDER_CREATED', order: { id: '123' } };
      const signature = crypto
        .createHmac('sha512', webhookSecret)
        .update(JSON.stringify(payload))
        .digest('hex');

      const result = provider.verifyWebhook(payload, {
        'x-getir-signature': signature,
      });

      expect(result).toBe(true);
    });

    it('should return false for missing signature', () => {
      const result = provider.verifyWebhook({}, {});
      expect(result).toBe(false);
    });

    it('should return false for invalid signature', () => {
      const result = provider.verifyWebhook(
        { test: 'data' },
        { 'x-getir-signature': 'invalid-signature' },
      );

      expect(result).toBe(false);
    });
  });

  describe('parseWebhookPayload', () => {
    it('should transform Getir order format', () => {
      const payload = {
        type: 'ORDER_RECEIVED',
        order: {
          id: 'getir-123',
          orderNo: 'GY-001',
          status: 'NEW',
          client: {
            name: 'John',
            phone: '555',
            deliveryAddress: { address: '123 St' },
          },
          products: [],
          totalPrice: 5000,
          paymentMethodId: 1,
          isPaid: true,
          createdAt: '2024-01-01T00:00:00Z',
        },
      };

      const result = provider.parseWebhookPayload(payload);

      expect(result).not.toBeNull();
      expect(result?.platformOrderId).toBe('getir-123');
      expect(result?.total).toBe(50); // 5000 kuruş = 50 TL
    });

    it('should return null for invalid payload', () => {
      const result = provider.parseWebhookPayload({ invalid: 'data' });
      expect(result).toBeNull();
    });
  });

  describe('testConnection', () => {
    it('should return success with latency', async () => {
      mockAxiosRef.request.mockResolvedValue({ data: { isOpen: true }, status: 200 });
      await provider.initialize('tenant-1');

      const result = await provider.testConnection();

      expect(result.success).toBe(true);
      expect(result.latencyMs).toBeDefined();
      expect(result.message).toContain('Connected');
    });

    it('should return failure on error', async () => {
      mockAxiosRef.request.mockRejectedValue(new Error('Connection refused'));
      await provider.initialize('tenant-1');

      const result = await provider.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection refused');
    });
  });

  describe('restaurant status', () => {
    it('should set restaurant open', async () => {
      mockAxiosRef.request.mockResolvedValue({ data: {}, status: 200 });
      await provider.initialize('tenant-1');

      await provider.setRestaurantOpen();

      expect(mockAxiosRef.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          url: expect.stringContaining('/restaurant/status'),
          data: { isOpen: true },
        }),
      );
    });

    it('should set restaurant closed with reason', async () => {
      mockAxiosRef.request.mockResolvedValue({ data: {}, status: 200 });
      await provider.initialize('tenant-1');

      await provider.setRestaurantClosed('Maintenance');

      expect(mockAxiosRef.request).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isOpen: false, reason: 'Maintenance' },
        }),
      );
    });

    it('should get restaurant status', async () => {
      mockAxiosRef.request.mockResolvedValue({ data: { isOpen: true }, status: 200 });
      await provider.initialize('tenant-1');

      const result = await provider.getRestaurantStatus();

      expect(result.isOpen).toBe(true);
    });
  });
});
