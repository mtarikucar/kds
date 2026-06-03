import { PaytrSettlementService } from './paytr-settlement.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';
import { Prisma } from '@prisma/client';
import { EventTypes } from '../../outbox/event-types';

/**
 * Step C decoupling: settlement no longer writes commissions — it determines
 * the commission KIND and emits `payment.succeeded.v1` inside the settlement
 * tx. These tests lock the producer side (which kind, when, and "no event on a
 * plain first activation"); the marketing SettlementCommissionConsumer spec
 * covers the actual crediting. Plus ALREADY_TERMINAL idempotency.
 */
describe('PaytrSettlementService — payment.succeeded emission', () => {
  let prisma: MockPrismaClient;
  let billing: any;
  let notifications: any;
  let outbox: { append: jest.Mock };
  let svc: PaytrSettlementService;

  /** The payment.succeeded.v1 calls among all outbox.append invocations. */
  function paymentSucceededCalls() {
    return outbox.append.mock.calls.filter(
      (c: any[]) => c[0]?.type === EventTypes.PaymentSucceeded,
    );
  }

  const MERCHANT_OID = 'SUB-tenant-1-abc';
  const PLAN_ID = 'plan-pro';
  const TENANT_ID = 'tenant-1';

  const pendingPayment: any = {
    id: 'pay-1',
    paytrMerchantOid: MERCHANT_OID,
    amount: new Prisma.Decimal('799'),
    status: 'PENDING',
    referredByMarketingUserId: null,
    referralCode: null,
    subscription: {
      id: 'sub-1',
      tenantId: TENANT_ID,
      planId: PLAN_ID,
      amount: new Prisma.Decimal('799'),
      currency: 'TRY',
      billingCycle: 'MONTHLY',
      paymentProvider: 'PAYTR',
      plan: {
        displayName: 'Profesyonel',
        monthlyPrice: new Prisma.Decimal('799'),
        yearlyPrice: new Prisma.Decimal('7990'),
        currency: 'TRY',
        commissionRate: new Prisma.Decimal('0.15'),
      },
      tenant: { id: TENANT_ID, name: 'Test Restoran' },
    },
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    billing = { createInvoice: jest.fn().mockResolvedValue({ invoiceNumber: 'INV-001' }) };
    notifications = {
      sendSubscriptionActivated: jest.fn().mockResolvedValue(undefined),
    };
    outbox = { append: jest.fn().mockResolvedValue('outbox-id') };
    svc = new PaytrSettlementService(
      prisma as any,
      billing,
      notifications,
      // Emits SubscriptionActivated/Upgraded AND (Step C) payment.succeeded.v1
      // inside applySuccess. The mock prisma.$transaction passes prisma itself
      // as `tx`, so the append lands on this same stub.
      outbox as any,
    );

    prisma.subscriptionPayment.findUnique.mockResolvedValue(pendingPayment);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.pendingPlanChange.findUnique.mockResolvedValue(null);
    prisma.subscription.update.mockResolvedValue({} as any);
    prisma.tenant.update.mockResolvedValue({} as any);
    // Race-safe claim path: updateMany returns the count, then a
    // findUniqueOrThrow re-reads the now-SUCCEEDED row.
    prisma.subscriptionPayment.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.subscriptionPayment.findUniqueOrThrow.mockResolvedValue({
      ...pendingPayment,
      status: 'SUCCEEDED',
    } as any);
    prisma.subscriptionPayment.update.mockResolvedValue({ ...pendingPayment, status: 'SUCCEEDED' } as any);
    prisma.user.findFirst.mockResolvedValue({ email: 'admin@example.com' } as any);
    prisma.subscription.findFirst.mockResolvedValue({
      ...pendingPayment.subscription,
      status: 'ACTIVE',
    } as any);
  });

  it('emits payment.succeeded.v1 with kind=renewal when a prior SUCCEEDED payment exists', async () => {
    prisma.subscriptionPayment.count.mockResolvedValue(1);

    await svc.settlePayment(MERCHANT_OID, { kind: 'success', paymentType: 'card' });

    const calls = paymentSucceededCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({
      type: EventTypes.PaymentSucceeded,
      idempotencyKey: 'payment-succeeded:pay-1',
      payload: expect.objectContaining({
        kind: 'renewal',
        tenantId: TENANT_ID,
        paymentId: 'pay-1',
        amount: 799,
        commissionRate: 0.15,
      }),
    });
    // Settlement no longer writes commissions directly.
    expect(prisma.commission.create).not.toHaveBeenCalled();
  });

  it('emits NO payment.succeeded.v1 on a plain first activation (no prior, no referral)', async () => {
    prisma.subscriptionPayment.count.mockResolvedValue(0);

    await svc.settlePayment(MERCHANT_OID, { kind: 'success' });

    expect(paymentSucceededCalls()).toHaveLength(0);
    expect(prisma.commission.create).not.toHaveBeenCalled();
  });

  it('emits payment.succeeded.v1 with kind=signup for a referred first activation', async () => {
    prisma.subscriptionPayment.count.mockResolvedValue(0);
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      ...pendingPayment,
      referredByMarketingUserId: 'marketing-rep-9',
      referralCode: 'AHMET42',
    } as any);

    await svc.settlePayment(MERCHANT_OID, { kind: 'success' });

    const calls = paymentSucceededCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][0].payload).toMatchObject({
      kind: 'signup',
      referredByMarketingUserId: 'marketing-rep-9',
      referralCode: 'AHMET42',
      tenantName: 'Test Restoran',
    });
  });

  it('does not pass utoken-storage logic (paytrRecurringToken removed)', async () => {
    prisma.subscriptionPayment.count.mockResolvedValue(0);

    await svc.settlePayment(MERCHANT_OID, { kind: 'success' });

    // tenant.update should be called WITHOUT paytrRecurringToken
    const tenantCalls = (prisma.tenant.update as any).mock.calls;
    expect(tenantCalls.length).toBeGreaterThan(0);
    for (const call of tenantCalls) {
      expect(call[0].data).not.toHaveProperty('paytrRecurringToken');
    }
  });
});

describe('PaytrSettlementService — idempotency', () => {
  let prisma: MockPrismaClient;
  let svc: PaytrSettlementService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new PaytrSettlementService(
      prisma as any,
      {} as any,
      {} as any,
      { append: jest.fn().mockResolvedValue('outbox-id') } as any,
    );
  });

  it('returns UNKNOWN_OID when no payment row matches', async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue(null);
    const result = await svc.settlePayment('NOPE', { kind: 'success' });
    expect(result).toBe('UNKNOWN_OID');
  });

  it('returns ALREADY_TERMINAL for SUCCEEDED payments (replay)', async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      id: 'pay-1',
      status: 'SUCCEEDED',
      subscription: {},
    } as any);
    const result = await svc.settlePayment('X', { kind: 'success' });
    expect(result).toBe('ALREADY_TERMINAL');
  });

  it('returns ALREADY_TERMINAL for FAILED payments (replay)', async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      id: 'pay-1',
      status: 'FAILED',
      subscription: {},
    } as any);
    const result = await svc.settlePayment('X', { kind: 'failure' });
    expect(result).toBe('ALREADY_TERMINAL');
  });

  it('returns ALREADY_TERMINAL for REFUNDED payments (replay)', async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      id: 'pay-1',
      status: 'REFUNDED',
      subscription: {},
    } as any);
    const result = await svc.settlePayment('X', { kind: 'success' });
    expect(result).toBe('ALREADY_TERMINAL');
  });
});
