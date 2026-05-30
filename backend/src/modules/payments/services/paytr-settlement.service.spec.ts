import { PaytrSettlementService } from './paytr-settlement.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';
import { Prisma } from '@prisma/client';

/**
 * Settlement service tests focused on commission routing (the new RENEWAL
 * path) and ALREADY_TERMINAL idempotency. Full success-path side-effects
 * (period bump, invoice creation, notifications) are exercised by the
 * e2e suite via simulatePaytrSuccess.
 */
describe('PaytrSettlementService — commission routing', () => {
  let prisma: MockPrismaClient;
  let billing: any;
  let notifications: any;
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
    svc = new PaytrSettlementService(
      prisma as any,
      billing,
      notifications,
      // v2.8.89: OutboxService stub for SubscriptionActivated/Upgraded
      // event emitted inside applySuccess. The mock prisma.$transaction
      // passes prisma itself as `tx`, so we wire outboxEvent.create as
      // a no-op there too.
      { append: jest.fn().mockResolvedValue('outbox-id') } as any,
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
    prisma.lead.findFirst.mockResolvedValue(null);
    prisma.commission.create.mockResolvedValue({} as any);
  });

  it('credits a RENEWAL commission when a prior SUCCEEDED payment exists', async () => {
    // Simulate that the subscription already has 1 prior SUCCEEDED payment
    prisma.subscriptionPayment.count.mockResolvedValue(1);
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-1',
      assignedToId: 'marketing-rep-1',
    } as any);

    await svc.settlePayment(MERCHANT_OID, { kind: 'success', paymentType: 'card' });
    // Let post-commit fire-and-forget complete.
    await new Promise((r) => setImmediate(r));

    expect(prisma.commission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'RENEWAL',
          status: 'PENDING',
          tenantId: TENANT_ID,
          leadId: 'lead-1',
          marketingUserId: 'marketing-rep-1',
        }),
      }),
    );
  });

  it('does NOT credit a RENEWAL commission on first activation (no prior payments)', async () => {
    prisma.subscriptionPayment.count.mockResolvedValue(0);
    prisma.lead.findFirst.mockResolvedValue({
      id: 'lead-1',
      assignedToId: 'marketing-rep-1',
    } as any);

    await svc.settlePayment(MERCHANT_OID, { kind: 'success' });
    await new Promise((r) => setImmediate(r));

    // No RENEWAL commission created.
    const renewalCalls = (prisma.commission.create as any).mock.calls.filter(
      (c: any[]) => c[0]?.data?.type === 'RENEWAL',
    );
    expect(renewalCalls).toHaveLength(0);
  });

  it('does NOT credit a RENEWAL commission when the tenant has no marketing lead', async () => {
    prisma.subscriptionPayment.count.mockResolvedValue(2);
    prisma.lead.findFirst.mockResolvedValue(null);

    await svc.settlePayment(MERCHANT_OID, { kind: 'success' });
    await new Promise((r) => setImmediate(r));

    const renewalCalls = (prisma.commission.create as any).mock.calls.filter(
      (c: any[]) => c[0]?.data?.type === 'RENEWAL',
    );
    expect(renewalCalls).toHaveLength(0);
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
