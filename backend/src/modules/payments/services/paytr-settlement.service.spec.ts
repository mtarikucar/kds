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

  it('records the CHARGED (discounted) amount on an upgrade settlement, not the gross plan price', async () => {
    prisma.subscriptionPayment.count.mockResolvedValue(1);
    // payment.amount (799) is the discounted price actually charged; the target
    // plan's gross is higher (999). The settlement must persist 799, not 999.
    prisma.pendingPlanChange.findUnique.mockResolvedValue({
      id: 'ppc-1',
      merchantOid: MERCHANT_OID,
      targetPlanId: 'plan-business',
      billingCycle: 'MONTHLY',
      targetPlan: {
        id: 'plan-business',
        name: 'BUSINESS',
        displayName: 'Business',
        monthlyPrice: new Prisma.Decimal('999'),
        yearlyPrice: new Prisma.Decimal('9990'),
        currency: 'TRY',
        commissionRate: new Prisma.Decimal('0.15'),
      },
    } as any);

    await svc.settlePayment(MERCHANT_OID, { kind: 'success', paymentType: 'card' });

    const subUpdate = (prisma.subscription.update as any).mock.calls.find(
      (c: any) => c[0]?.data?.amount !== undefined,
    );
    expect(subUpdate).toBeDefined();
    // 799 (charged/discounted), NOT 999 (gross target price).
    expect(Number(subUpdate[0].data.amount)).toBe(799);
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

describe('PaytrSettlementService — settlement outcome metric', () => {
  let prisma: MockPrismaClient;
  let billing: any;
  let notifications: any;
  let outbox: { append: jest.Mock };
  let metrics: { incCounter: jest.Mock };
  let svc: PaytrSettlementService;

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
        name: 'pro',
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
    metrics = { incCounter: jest.fn() };
    svc = new PaytrSettlementService(
      prisma as any,
      billing,
      notifications,
      outbox as any,
      metrics as any,
    );

    prisma.subscriptionPayment.findUnique.mockResolvedValue(pendingPayment);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.pendingPlanChange.findUnique.mockResolvedValue(null);
    prisma.subscription.update.mockResolvedValue({} as any);
    prisma.tenant.update.mockResolvedValue({} as any);
    prisma.subscriptionPayment.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.subscriptionPayment.findUniqueOrThrow.mockResolvedValue({
      ...pendingPayment,
      status: 'SUCCEEDED',
    } as any);
    prisma.subscriptionPayment.update.mockResolvedValue({ ...pendingPayment, status: 'FAILED' } as any);
    prisma.subscriptionPayment.count.mockResolvedValue(0);
    prisma.user.findFirst.mockResolvedValue({ email: 'admin@example.com' } as any);
    prisma.subscription.findFirst.mockResolvedValue({
      ...pendingPayment.subscription,
      status: 'ACTIVE',
    } as any);
  });

  it('emits paytr_settlement_total{result:success} after a committed success settlement', async () => {
    const result = await svc.settlePayment(MERCHANT_OID, { kind: 'success', paymentType: 'card' });

    expect(result).toBe('OK');
    expect(metrics.incCounter).toHaveBeenCalledWith(
      'paytr_settlement_total',
      expect.any(String),
      { result: 'success' },
    );
    // bounded enum label — never the failure variant on a success path.
    const labels = metrics.incCounter.mock.calls
      .filter((c: any[]) => c[0] === 'paytr_settlement_total')
      .map((c: any[]) => c[2].result);
    expect(labels).toEqual(['success']);
  });

  it('emits paytr_settlement_total{result:failure} after a committed failure settlement', async () => {
    const result = await svc.settlePayment(MERCHANT_OID, {
      kind: 'failure',
      failureCode: 'DECLINED',
      failureMessage: 'card declined',
    });

    expect(result).toBe('OK');
    // The FAILED write must land before the counter increments.
    expect(prisma.subscriptionPayment.update).toHaveBeenCalled();
    expect(metrics.incCounter).toHaveBeenCalledWith(
      'paytr_settlement_total',
      expect.any(String),
      { result: 'failure' },
    );
  });

  it('does not emit a settlement metric when the settlement is ALREADY_TERMINAL', async () => {
    prisma.subscriptionPayment.findUnique.mockResolvedValue({
      id: 'pay-1',
      status: 'SUCCEEDED',
      subscription: {},
    } as any);

    const result = await svc.settlePayment(MERCHANT_OID, { kind: 'success' });

    expect(result).toBe('ALREADY_TERMINAL');
    expect(metrics.incCounter).not.toHaveBeenCalled();
  });
});

describe('PaytrSettlementService — metrics optional (no MetricsService bound)', () => {
  let prisma: MockPrismaClient;
  let svc: PaytrSettlementService;

  const MERCHANT_OID = 'SUB-tenant-1-abc';

  const pendingPayment: any = {
    id: 'pay-1',
    paytrMerchantOid: MERCHANT_OID,
    amount: new Prisma.Decimal('799'),
    status: 'PENDING',
    referredByMarketingUserId: null,
    referralCode: null,
    subscription: {
      id: 'sub-1',
      tenantId: 'tenant-1',
      planId: 'plan-pro',
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
        name: 'pro',
      },
      tenant: { id: 'tenant-1', name: 'Test Restoran' },
    },
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    // No 5th constructor arg → metrics is undefined (the @Optional() path).
    svc = new PaytrSettlementService(
      prisma as any,
      { createInvoice: jest.fn().mockResolvedValue({ invoiceNumber: 'INV-001' }) } as any,
      { sendSubscriptionActivated: jest.fn().mockResolvedValue(undefined) } as any,
      { append: jest.fn().mockResolvedValue('outbox-id') } as any,
    );
    prisma.subscriptionPayment.findUnique.mockResolvedValue(pendingPayment);
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.pendingPlanChange.findUnique.mockResolvedValue(null);
    prisma.subscription.update.mockResolvedValue({} as any);
    prisma.tenant.update.mockResolvedValue({} as any);
    prisma.subscriptionPayment.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.subscriptionPayment.findUniqueOrThrow.mockResolvedValue({
      ...pendingPayment,
      status: 'SUCCEEDED',
    } as any);
    prisma.subscriptionPayment.update.mockResolvedValue({ ...pendingPayment, status: 'FAILED' } as any);
    prisma.subscriptionPayment.count.mockResolvedValue(0);
    prisma.user.findFirst.mockResolvedValue({ email: 'admin@example.com' } as any);
    prisma.subscription.findFirst.mockResolvedValue({
      ...pendingPayment.subscription,
      status: 'ACTIVE',
    } as any);
  });

  it('settles a success without throwing when no MetricsService is bound', async () => {
    await expect(
      svc.settlePayment(MERCHANT_OID, { kind: 'success', paymentType: 'card' }),
    ).resolves.toBe('OK');
  });

  it('settles a failure without throwing when no MetricsService is bound', async () => {
    await expect(
      svc.settlePayment(MERCHANT_OID, { kind: 'failure', failureCode: 'DECLINED' }),
    ).resolves.toBe('OK');
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
