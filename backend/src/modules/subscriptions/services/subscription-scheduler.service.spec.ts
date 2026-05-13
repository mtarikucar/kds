import { SubscriptionSchedulerService } from './subscription-scheduler.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Focused unit tests for the recurring-charge branch of the renewal cron.
 * The legacy fallback (renewSubscription → PAST_DUE) is already exercised
 * by the e2e suite; here we isolate the PayTR token path so we can assert
 * the success / failure side-effects in isolation.
 */
describe('SubscriptionSchedulerService.renewOneSubscription', () => {
  let prisma: MockPrismaClient;
  let subscriptionService: any;
  let notifications: any;
  let billing: any;
  let paytr: any;
  let svc: SubscriptionSchedulerService;

  const baseTenant = {
    id: 'tenant-1',
    name: 'Test Restoran',
    paymentRegion: 'TURKEY',
    paytrRecurringToken: 'v1:enc:auth:cipher',
  };

  const baseSub: any = {
    id: 'sub-1',
    amount: { toString: () => '799' } as any,
    currency: 'TRY',
    billingCycle: 'MONTHLY',
    paymentProvider: 'PAYTR',
    currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
    plan: { displayName: 'Profesyonel' },
    tenant: baseTenant,
  };

  function callRenew(sub: any): Promise<void> {
    return (svc as any).renewOneSubscription(sub);
  }

  beforeEach(() => {
    prisma = mockPrismaClient();
    subscriptionService = {
      renewSubscription: jest.fn().mockResolvedValue({}),
    };
    notifications = { sendPaymentSuccessful: jest.fn().mockResolvedValue(undefined) };
    billing = {
      createInvoice: jest.fn().mockResolvedValue({ invoiceNumber: 'INV-202604-0001-aaaaaa' }),
    };
    paytr = { chargeRecurring: jest.fn() };
    svc = new SubscriptionSchedulerService(
      prisma as any,
      subscriptionService,
      notifications,
      billing,
      paytr,
    );
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.subscriptionPayment.create.mockResolvedValue({ id: 'pay-1' } as any);
    prisma.subscription.update.mockResolvedValue({} as any);
    prisma.user.findFirst.mockResolvedValue({ email: 'admin@example.com' } as any);
  });

  it('skips PayTR and falls back to legacy renew when tenant has no recurring token', async () => {
    await callRenew({ ...baseSub, tenant: { ...baseTenant, paytrRecurringToken: null } });
    expect(paytr.chargeRecurring).not.toHaveBeenCalled();
    expect(subscriptionService.renewSubscription).toHaveBeenCalledWith('sub-1');
  });

  it('skips PayTR for INTERNATIONAL tenants even with a token', async () => {
    await callRenew({
      ...baseSub,
      tenant: { ...baseTenant, paymentRegion: 'INTERNATIONAL' },
    });
    expect(paytr.chargeRecurring).not.toHaveBeenCalled();
    expect(subscriptionService.renewSubscription).toHaveBeenCalled();
  });

  it('records FAILED payment and falls back when PayTR rejects the charge', async () => {
    paytr.chargeRecurring.mockResolvedValue({
      status: 'failed',
      reason: 'insufficient_funds',
      raw: {},
    });

    await callRenew(baseSub);

    expect(prisma.subscriptionPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          paymentProvider: 'PAYTR',
          failureCode: 'RECURRING_FAILED',
          failureMessage: 'insufficient_funds',
        }),
      }),
    );
    expect(subscriptionService.renewSubscription).toHaveBeenCalledWith('sub-1');
  });

  it('on success writes SUCCEEDED payment, bumps period, creates invoice, sends email', async () => {
    paytr.chargeRecurring.mockResolvedValue({ status: 'success', raw: {} });

    await callRenew(baseSub);
    await new Promise((r) => setImmediate(r)); // flush microtasks for the void email

    // Payment row written as SUCCEEDED with the new merchantOid
    const createCalls = prisma.subscriptionPayment.create.mock.calls.map((c) => c[0]);
    expect(createCalls[0].data.status).toBe('SUCCEEDED');
    expect(createCalls[0].data.paymentProvider).toBe('PAYTR');
    expect(createCalls[0].data.paytrMerchantOid).toMatch(/^RNW[A-Za-z0-9]+$/);

    // Subscription period bumped
    expect(prisma.subscription.update).toHaveBeenCalled();
    const subUpdate = prisma.subscription.update.mock.calls[0][0];
    expect(subUpdate.data.currentPeriodEnd).toBeInstanceOf(Date);

    // Invoice issued
    expect(billing.createInvoice).toHaveBeenCalled();

    // Best-effort success email
    expect(notifications.sendPaymentSuccessful).toHaveBeenCalledWith(
      'admin@example.com',
      'Test Restoran',
      expect.any(Number),
      'TRY',
      'INV-202604-0001-aaaaaa',
    );
  });

  it('anchors the new period on currentPeriodEnd (not now) when the period is still live', async () => {
    paytr.chargeRecurring.mockResolvedValue({ status: 'success', raw: {} });
    const liveEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await callRenew({ ...baseSub, currentPeriodEnd: liveEnd });

    const subUpdate = prisma.subscription.update.mock.calls[0][0];
    // Period should start exactly at the old end, not now-ish.
    expect((subUpdate.data.currentPeriodStart as Date).getTime()).toBe(liveEnd.getTime());
  });

  it('falls back to now when the period has already passed', async () => {
    paytr.chargeRecurring.mockResolvedValue({ status: 'success', raw: {} });
    const before = Date.now();
    const expiredEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await callRenew({ ...baseSub, currentPeriodEnd: expiredEnd });

    const subUpdate = prisma.subscription.update.mock.calls[0][0];
    const start = (subUpdate.data.currentPeriodStart as Date).getTime();
    // start is ~now (within the test execution window), not in the past
    expect(start).toBeGreaterThanOrEqual(before);
  });
});
