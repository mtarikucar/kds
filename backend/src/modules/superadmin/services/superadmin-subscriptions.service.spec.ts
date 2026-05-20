import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SuperAdminSubscriptionsService } from './superadmin-subscriptions.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Unit tests for the refundPayment ops endpoint. Real PayTR calls are
 * mocked at the PaytrAdapter boundary so we only assert this service's
 * eligibility checks, state transition, and audit-trail handoff.
 */
describe('SuperAdminSubscriptionsService.refundPayment', () => {
  let prisma: MockPrismaClient;
  let audit: any;
  let subscriptionService: any;
  let paytr: any;
  let svc: SuperAdminSubscriptionsService;

  const SUB_ID = 'sub-1';
  const PAYMENT_ID = 'pay-1';
  const TENANT_ID = 'tenant-1';
  const MERCHANT_OID = 'SUB-tenant-1-abc';

  const successfulPayment: any = {
    id: PAYMENT_ID,
    subscriptionId: SUB_ID,
    status: 'SUCCEEDED',
    amount: new Prisma.Decimal('799'),
    paidAt: new Date(),
    paytrMerchantOid: MERCHANT_OID,
    subscription: {
      id: SUB_ID,
      tenantId: TENANT_ID,
      tenant: { name: 'Test Restoran' },
    },
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    subscriptionService = {};
    paytr = {
      refund: jest.fn().mockResolvedValue({ status: 'success', raw: {} }),
    };
    svc = new SuperAdminSubscriptionsService(
      prisma as any,
      audit,
      subscriptionService,
      { handleSubscriptionPeriodEnd: jest.fn(), handleSubscriptionExpiryReminders: jest.fn() } as any,
      paytr,
    );
  });

  it('throws NotFound when the payment does not exist', async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue(null);
    await expect(
      svc.refundPayment(SUB_ID, { paymentId: PAYMENT_ID, reason: 'test' }, 'a1', 'a@x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws BadRequest when the payment belongs to a different subscription', async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      ...successfulPayment,
      subscriptionId: 'other-sub',
    });
    await expect(
      svc.refundPayment(SUB_ID, { paymentId: PAYMENT_ID, reason: 'test' }, 'a1', 'a@x'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequest when the payment is not in SUCCEEDED state', async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      ...successfulPayment,
      status: 'PENDING',
    });
    await expect(
      svc.refundPayment(SUB_ID, { paymentId: PAYMENT_ID, reason: 'test' }, 'a1', 'a@x'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequest when the payment has no paytrMerchantOid', async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      ...successfulPayment,
      paytrMerchantOid: null,
    });
    await expect(
      svc.refundPayment(SUB_ID, { paymentId: PAYMENT_ID, reason: 'test' }, 'a1', 'a@x'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequest when the requested amount exceeds the original', async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue(successfulPayment);
    await expect(
      svc.refundPayment(
        SUB_ID,
        { paymentId: PAYMENT_ID, amount: 1000, reason: 'oversized' },
        'a1',
        'a@x',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(paytr.refund).not.toHaveBeenCalled();
  });

  it('full refund: calls PayTR with payment.amount and writes REFUNDED + audit', async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue(successfulPayment);
    prisma.subscriptionPayment.update.mockResolvedValue({
      ...successfulPayment,
      status: 'REFUNDED',
    });

    await svc.refundPayment(
      SUB_ID,
      { paymentId: PAYMENT_ID, reason: 'customer requested' },
      'actor-1',
      'actor@example.com',
    );

    expect(paytr.refund).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOid: MERCHANT_OID,
        // refund() accepts Decimal | number | string — assert the value
        amount: expect.anything(),
      }),
    );
    expect(prisma.subscriptionPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAYMENT_ID },
        data: expect.objectContaining({
          status: 'REFUNDED',
          refundedAt: expect.any(Date),
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'REFUND',
        entityType: 'SUBSCRIPTION',
        entityId: SUB_ID,
        actorId: 'actor-1',
        actorEmail: 'actor@example.com',
        newData: expect.objectContaining({
          status: 'REFUNDED',
          refundedAmount: expect.any(String),
          reason: 'customer requested',
        }),
      }),
    );
  });

  it('partial refund: passes the smaller amount to PayTR but still REFUNDED', async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue(successfulPayment);
    prisma.subscriptionPayment.update.mockResolvedValue(successfulPayment);

    await svc.refundPayment(
      SUB_ID,
      { paymentId: PAYMENT_ID, amount: 100, reason: 'partial' },
      'a1',
      'a@x',
    );

    const refundCall = paytr.refund.mock.calls[0][0];
    expect(new Prisma.Decimal(refundCall.amount).toString()).toBe('100');
    // Audit captures the partial amount so support can later reconstruct.
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        newData: expect.objectContaining({ refundedAmount: '100' }),
      }),
    );
  });

  it('surfaces PayTR rejections as BadRequestException with the reason', async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue(successfulPayment);
    paytr.refund.mockResolvedValue({
      status: 'failed',
      reason: 'transaction_too_old',
      raw: {},
    });

    await expect(
      svc.refundPayment(SUB_ID, { paymentId: PAYMENT_ID, reason: 'test' }, 'a1', 'a@x'),
    ).rejects.toThrow('transaction_too_old');
    // Payment row stays SUCCEEDED on PayTR-side failures.
    expect(prisma.subscriptionPayment.update).not.toHaveBeenCalled();
  });

  it('14-day cooling-off: logs warning but allows refund (soft check)', async () => {
    const oldPaidAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      ...successfulPayment,
      paidAt: oldPaidAt,
    });
    prisma.subscriptionPayment.update.mockResolvedValue(successfulPayment);
    const warnSpy = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

    await svc.refundPayment(
      SUB_ID,
      { paymentId: PAYMENT_ID, reason: 'goodwill' },
      'a1',
      'a@x',
    );

    expect(warnSpy).toHaveBeenCalled();
    expect(paytr.refund).toHaveBeenCalled(); // not blocked
    expect(prisma.subscriptionPayment.update).toHaveBeenCalled();
  });
});
