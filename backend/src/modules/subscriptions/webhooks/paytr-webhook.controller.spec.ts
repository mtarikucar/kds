import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { PaytrWebhookController } from './paytr-webhook.controller';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaytrService, PaytrCallbackPayload } from '../services/paytr.service';
import { BillingService } from '../services/billing.service';
import { NotificationService } from '../services/notification.service';
import { mockPrismaClient } from '../../../common/test/prisma-mock.service';

describe('PaytrWebhookController', () => {
  let controller: PaytrWebhookController;
  let prisma: ReturnType<typeof mockPrismaClient>;
  let paytrService: jest.Mocked<PaytrService>;
  let billingService: jest.Mocked<BillingService>;
  let notificationService: jest.Mocked<NotificationService>;
  let mockResponse: Partial<Response>;

  const mockSubscription = {
    id: 'sub-123',
    tenantId: 'tenant-123',
    planId: 'plan-pro',
    status: 'PENDING',
    billingCycle: 'MONTHLY',
    paymentProvider: 'PAYTR',
    amount: 299.99,
    currency: 'TRY',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(),
    plan: {
      id: 'plan-pro',
      name: 'PRO',
      displayName: 'Pro Plan',
    },
    tenant: {
      id: 'tenant-123',
      name: 'Test Restaurant',
    },
  };

  const mockPayment = {
    id: 'payment-123',
    subscriptionId: 'sub-123',
    amount: 299.99,
    currency: 'TRY',
    status: 'PENDING',
    paymentProvider: 'PAYTR',
    paytrMerchantOid: 'SUB-sub-123-1234567890',
    subscription: mockSubscription,
  };

  beforeEach(async () => {
    prisma = mockPrismaClient();

    mockResponse = {
      send: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaytrWebhookController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        {
          provide: PaytrService,
          useValue: {
            verifyCallback: jest.fn(),
            parseCallback: jest.fn(),
          },
        },
        {
          provide: BillingService,
          useValue: {
            createInvoice: jest.fn(),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            sendPaymentSuccessful: jest.fn(),
            sendPaymentFailed: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PaytrWebhookController>(PaytrWebhookController);
    paytrService = module.get(PaytrService);
    billingService = module.get(BillingService);
    notificationService = module.get(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleCallback', () => {
    const validPayload: PaytrCallbackPayload = {
      merchant_oid: 'SUB-sub-123-1234567890',
      status: 'success',
      total_amount: '29999',
      hash: 'valid_hash',
    };

    it('should return FAIL when hash verification fails', async () => {
      paytrService.verifyCallback.mockReturnValue(false);

      await controller.handleCallback(validPayload, mockResponse as Response);

      expect(mockResponse.send).toHaveBeenCalledWith('FAIL');
    });

    it('should process successful payment and return OK', async () => {
      paytrService.verifyCallback.mockReturnValue(true);
      prisma.subscriptionPayment.findFirst.mockResolvedValue(mockPayment as any);
      prisma.subscriptionPayment.update.mockResolvedValue(mockPayment as any);
      prisma.subscription.update.mockResolvedValue(mockSubscription as any);
      prisma.tenant.update.mockResolvedValue(mockSubscription.tenant as any);
      prisma.user.findFirst.mockResolvedValue({ email: 'admin@test.com' } as any);
      billingService.createInvoice.mockResolvedValue({ invoiceNumber: 'INV-2024-001' } as any);

      await controller.handleCallback(validPayload, mockResponse as Response);

      expect(prisma.subscriptionPayment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payment-123' },
          data: expect.objectContaining({
            status: 'SUCCEEDED',
          }),
        }),
      );
      expect(prisma.subscription.update).toHaveBeenCalled();
      expect(billingService.createInvoice).toHaveBeenCalled();
      expect(notificationService.sendPaymentSuccessful).toHaveBeenCalled();
      expect(mockResponse.send).toHaveBeenCalledWith('OK');
    });

    it('should process failed payment and return OK', async () => {
      const failedPayload: PaytrCallbackPayload = {
        merchant_oid: 'SUB-sub-123-1234567890',
        status: 'failed',
        total_amount: '29999',
        hash: 'valid_hash',
        failed_reason_code: 'INSUFFICIENT_FUNDS',
        failed_reason_msg: 'Yetersiz bakiye',
      };

      paytrService.verifyCallback.mockReturnValue(true);
      prisma.subscriptionPayment.findFirst.mockResolvedValue(mockPayment as any);
      prisma.subscriptionPayment.update.mockResolvedValue(mockPayment as any);
      prisma.user.findFirst.mockResolvedValue({ email: 'admin@test.com' } as any);

      await controller.handleCallback(failedPayload, mockResponse as Response);

      expect(prisma.subscriptionPayment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'payment-123' },
          data: expect.objectContaining({
            status: 'FAILED',
            failureCode: 'INSUFFICIENT_FUNDS',
            failureMessage: 'Yetersiz bakiye',
          }),
        }),
      );
      expect(notificationService.sendPaymentFailed).toHaveBeenCalled();
      expect(mockResponse.send).toHaveBeenCalledWith('OK');
    });

    it('should return OK even when payment is not found (idempotency)', async () => {
      paytrService.verifyCallback.mockReturnValue(true);
      prisma.subscriptionPayment.findFirst.mockResolvedValue(null);

      await controller.handleCallback(validPayload, mockResponse as Response);

      expect(mockResponse.send).toHaveBeenCalledWith('OK');
    });

    it('should return FAIL when an error occurs during processing', async () => {
      paytrService.verifyCallback.mockReturnValue(true);
      prisma.subscriptionPayment.findFirst.mockRejectedValue(new Error('Database error'));

      await controller.handleCallback(validPayload, mockResponse as Response);

      expect(mockResponse.send).toHaveBeenCalledWith('FAIL');
    });

    it('should update subscription period correctly for monthly billing', async () => {
      paytrService.verifyCallback.mockReturnValue(true);
      prisma.subscriptionPayment.findFirst.mockResolvedValue({
        ...mockPayment,
        subscription: { ...mockSubscription, billingCycle: 'MONTHLY' },
      } as any);
      prisma.subscriptionPayment.update.mockResolvedValue(mockPayment as any);
      prisma.subscription.update.mockResolvedValue(mockSubscription as any);
      prisma.tenant.update.mockResolvedValue(mockSubscription.tenant as any);
      prisma.user.findFirst.mockResolvedValue(null);
      billingService.createInvoice.mockResolvedValue(null);

      await controller.handleCallback(validPayload, mockResponse as Response);

      const subscriptionUpdateCall = prisma.subscription.update.mock.calls[0][0];
      const updateData = subscriptionUpdateCall.data;

      expect(updateData.status).toBe('ACTIVE');
      expect(updateData.isTrialPeriod).toBe(false);

      // Verify period end is approximately 1 month in the future
      const periodEnd = new Date(updateData.currentPeriodEnd as Date);
      const now = new Date();
      const expectedMonth = now.getMonth() + 1;
      expect(periodEnd.getMonth()).toBe(expectedMonth % 12);
    });

    it('should update subscription period correctly for yearly billing', async () => {
      paytrService.verifyCallback.mockReturnValue(true);
      prisma.subscriptionPayment.findFirst.mockResolvedValue({
        ...mockPayment,
        subscription: { ...mockSubscription, billingCycle: 'YEARLY' },
      } as any);
      prisma.subscriptionPayment.update.mockResolvedValue(mockPayment as any);
      prisma.subscription.update.mockResolvedValue(mockSubscription as any);
      prisma.tenant.update.mockResolvedValue(mockSubscription.tenant as any);
      prisma.user.findFirst.mockResolvedValue(null);
      billingService.createInvoice.mockResolvedValue(null);

      await controller.handleCallback(validPayload, mockResponse as Response);

      const subscriptionUpdateCall = prisma.subscription.update.mock.calls[0][0];
      const updateData = subscriptionUpdateCall.data;

      // Verify period end is approximately 1 year in the future
      const periodEnd = new Date(updateData.currentPeriodEnd as Date);
      const now = new Date();
      expect(periodEnd.getFullYear()).toBe(now.getFullYear() + 1);
    });

    it('should not send notification when admin email is not found', async () => {
      paytrService.verifyCallback.mockReturnValue(true);
      prisma.subscriptionPayment.findFirst.mockResolvedValue(mockPayment as any);
      prisma.subscriptionPayment.update.mockResolvedValue(mockPayment as any);
      prisma.subscription.update.mockResolvedValue(mockSubscription as any);
      prisma.tenant.update.mockResolvedValue(mockSubscription.tenant as any);
      prisma.user.findFirst.mockResolvedValue(null);
      billingService.createInvoice.mockResolvedValue(null);

      await controller.handleCallback(validPayload, mockResponse as Response);

      expect(notificationService.sendPaymentSuccessful).not.toHaveBeenCalled();
      expect(mockResponse.send).toHaveBeenCalledWith('OK');
    });

    it('should increment retry count on failed payment', async () => {
      const failedPayload: PaytrCallbackPayload = {
        merchant_oid: 'SUB-sub-123-1234567890',
        status: 'failed',
        total_amount: '29999',
        hash: 'valid_hash',
      };

      paytrService.verifyCallback.mockReturnValue(true);
      prisma.subscriptionPayment.findFirst.mockResolvedValue(mockPayment as any);
      prisma.subscriptionPayment.update.mockResolvedValue(mockPayment as any);
      prisma.user.findFirst.mockResolvedValue(null);

      await controller.handleCallback(failedPayload, mockResponse as Response);

      expect(prisma.subscriptionPayment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            retryCount: { increment: 1 },
          }),
        }),
      );
    });
  });
});
