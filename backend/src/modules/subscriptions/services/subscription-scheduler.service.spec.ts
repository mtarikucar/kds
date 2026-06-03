import { SubscriptionSchedulerService } from './subscription-scheduler.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';
import { addDays } from 'date-fns';

/**
 * Tests for the manual-renewal cron jobs:
 *   - handleSubscriptionPeriodEnd: ACTIVE → PAST_DUE when period ends
 *   - handleSubscriptionExpiryReminders: 7d/3d/1d emails before period ends
 *   - handlePaytrPendingRecovery: webhook-loss recovery via PayTR inquiry
 *
 * Auto-renewal has been removed (PayTR Kart Saklama yetkisi closed) so
 * the legacy `renewOneSubscription` charge path is gone too — tests for
 * it were deleted with the implementation.
 */

function buildSvc(
  prisma: MockPrismaClient,
  paytr: any,
  notifications: any,
  settlement: any = { settlePayment: jest.fn().mockResolvedValue('OK') },
  outbox?: any,
): SubscriptionSchedulerService {
  const svc = new SubscriptionSchedulerService(
    prisma as any,
    {} as any, // subscriptionService — not used by the manual-renewal crons
    notifications,
    {} as any, // billing — not used by these crons
    paytr,
    settlement,
    outbox,
  );
  // Bypass the advisory-lock SQL probe — assume we acquired the lock.
  prisma.$queryRawUnsafe.mockResolvedValue([{ locked: true }]);
  return svc;
}

describe('SubscriptionSchedulerService.handleSubscriptionPeriodEnd', () => {
  let prisma: MockPrismaClient;
  let notifications: any;
  let svc: SubscriptionSchedulerService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    notifications = {
      sendSubscriptionPastDue: jest.fn().mockResolvedValue(undefined),
    };
    svc = buildSvc(prisma, {}, notifications);
  });

  it('moves ACTIVE subs with past currentPeriodEnd to PAST_DUE', async () => {
    const expiredSub = {
      id: 'sub-1',
      amount: 799,
      currency: 'TRY',
      currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000),
      plan: { displayName: 'Profesyonel' },
      tenant: { id: 'tenant-1', name: 'Test Restoran' },
    };
    prisma.subscription.findMany.mockResolvedValue([expiredSub] as any);
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.user.findFirst.mockResolvedValue({ email: 'admin@example.com' } as any);

    await svc.handleSubscriptionPeriodEnd();

    // Race-safe transition: compound WHERE on status=ACTIVE +
    // cancelAtPeriodEnd=false so a concurrent user cancel doesn't get
    // clobbered with PAST_DUE.
    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'sub-1',
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      },
      data: { status: 'PAST_DUE' },
    });
  });

  it('sends past-due email to tenant admin', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        amount: 799,
        currency: 'TRY',
        currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000),
        plan: { displayName: 'Profesyonel' },
        tenant: { id: 'tenant-1', name: 'Test Restoran' },
      },
    ] as any);
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 } as any);
    prisma.user.findFirst.mockResolvedValue({ email: 'admin@example.com' } as any);

    await svc.handleSubscriptionPeriodEnd();
    // Wait for the fire-and-forget catch chain to settle.
    await new Promise((r) => setImmediate(r));

    expect(notifications.sendSubscriptionPastDue).toHaveBeenCalledWith(
      'admin@example.com',
      'Test Restoran',
      'Profesyonel',
      799,
      'TRY',
    );
  });

  it('caps the batch at 200 rows per run', async () => {
    prisma.subscription.findMany.mockResolvedValue([] as any);

    await svc.handleSubscriptionPeriodEnd();

    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    );
  });

  it('skips email send when tenant admin has no email', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        amount: 799,
        currency: 'TRY',
        currentPeriodEnd: new Date(Date.now() - 1000),
        plan: { displayName: 'Profesyonel' },
        tenant: { id: 'tenant-1', name: 'X' },
      },
    ] as any);
    prisma.user.findFirst.mockResolvedValue(null);

    await svc.handleSubscriptionPeriodEnd();

    expect(notifications.sendSubscriptionPastDue).not.toHaveBeenCalled();
  });
});

describe('SubscriptionSchedulerService.handleSubscriptionExpiryReminders', () => {
  let prisma: MockPrismaClient;
  let notifications: any;
  let svc: SubscriptionSchedulerService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    notifications = {
      sendSubscriptionExpiryReminder: jest.fn().mockResolvedValue(undefined),
    };
    svc = buildSvc(prisma, {}, notifications);
    prisma.user.findFirst.mockResolvedValue({ email: 'admin@example.com' } as any);
  });

  it('queries 7d, 3d, and 1d windows', async () => {
    prisma.subscription.findMany.mockResolvedValue([] as any);

    await svc.handleSubscriptionExpiryReminders();

    // Three calls — one per window.
    expect(prisma.subscription.findMany).toHaveBeenCalledTimes(3);
  });

  it('sends reminder when a sub falls in the 7-day window', async () => {
    const subInWindow = {
      id: 'sub-7d',
      currentPeriodEnd: addDays(new Date(), 7),
      plan: { displayName: 'Profesyonel' },
      tenant: { id: 'tenant-1', name: 'Test Restoran' },
    };
    // findMany called for each window — return the sub only for the 7-day call.
    prisma.subscription.findMany.mockResolvedValueOnce([subInWindow] as any);
    prisma.subscription.findMany.mockResolvedValueOnce([] as any);
    prisma.subscription.findMany.mockResolvedValueOnce([] as any);

    await svc.handleSubscriptionExpiryReminders();

    expect(notifications.sendSubscriptionExpiryReminder).toHaveBeenCalledWith(
      'admin@example.com',
      'Test Restoran',
      'Profesyonel',
      expect.any(Date),
      7,
    );
  });

  it('sends reminder when a sub falls in the 3-day window', async () => {
    prisma.subscription.findMany.mockResolvedValueOnce([] as any);
    prisma.subscription.findMany.mockResolvedValueOnce([
      {
        id: 'sub-3d',
        currentPeriodEnd: addDays(new Date(), 3),
        plan: { displayName: 'Başlangıç' },
        tenant: { id: 'tenant-2', name: 'X' },
      },
    ] as any);
    prisma.subscription.findMany.mockResolvedValueOnce([] as any);

    await svc.handleSubscriptionExpiryReminders();

    expect(notifications.sendSubscriptionExpiryReminder).toHaveBeenCalledWith(
      'admin@example.com',
      'X',
      'Başlangıç',
      expect.any(Date),
      3,
    );
  });

  it('sends reminder when a sub falls in the 1-day window', async () => {
    prisma.subscription.findMany.mockResolvedValueOnce([] as any);
    prisma.subscription.findMany.mockResolvedValueOnce([] as any);
    prisma.subscription.findMany.mockResolvedValueOnce([
      {
        id: 'sub-1d',
        currentPeriodEnd: addDays(new Date(), 1),
        plan: { displayName: 'Pro' },
        tenant: { id: 'tenant-3', name: 'Y' },
      },
    ] as any);

    await svc.handleSubscriptionExpiryReminders();

    expect(notifications.sendSubscriptionExpiryReminder).toHaveBeenCalledWith(
      'admin@example.com',
      'Y',
      'Pro',
      expect.any(Date),
      1,
    );
  });

  it('does not send when no subs fall in any window', async () => {
    prisma.subscription.findMany.mockResolvedValue([] as any);

    await svc.handleSubscriptionExpiryReminders();

    expect(notifications.sendSubscriptionExpiryReminder).not.toHaveBeenCalled();
  });
});

/**
 * Hourly webhook-recovery sweeper. The cron asks PayTR for the real
 * status of any SubscriptionPayment stuck in PENDING for ≥ 2 hours,
 * then delegates the state transition to PaytrSettlementService. These
 * tests fence off the dispatch logic so the settlement service itself
 * stays out of scope (it's mocked).
 */
describe('SubscriptionSchedulerService.handlePaytrPendingRecovery', () => {
  let prisma: MockPrismaClient;
  let paytr: any;
  let settlement: any;
  let svc: SubscriptionSchedulerService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    paytr = { chargeRecurring: jest.fn(), inquiryStatus: jest.fn() };
    settlement = { settlePayment: jest.fn().mockResolvedValue('OK') };
    svc = buildSvc(prisma, paytr, {}, settlement);
  });

  it('dispatches inquiry-success rows to settlement.settlePayment with kind=success', async () => {
    prisma.subscriptionPayment.findMany.mockResolvedValue([
      { id: 'pay-1', paytrMerchantOid: 'OID1' },
    ] as any);
    paytr.inquiryStatus.mockResolvedValue({
      status: 'success',
      paymentType: 'card',
      paymentAmount: '79900',
      raw: {},
    });

    await svc.handlePaytrPendingRecovery();

    expect(paytr.inquiryStatus).toHaveBeenCalledWith('OID1');
    expect(settlement.settlePayment).toHaveBeenCalledWith('OID1', {
      kind: 'success',
      paymentType: 'card',
      totalAmount: '79900',
    });
  });

  it('dispatches inquiry-failed rows with the failure reason fields', async () => {
    prisma.subscriptionPayment.findMany.mockResolvedValue([
      { id: 'pay-2', paytrMerchantOid: 'OID2' },
    ] as any);
    paytr.inquiryStatus.mockResolvedValue({
      status: 'failed',
      failedReasonCode: '99',
      failedReasonMsg: 'do_not_honor',
      raw: {},
    });

    await svc.handlePaytrPendingRecovery();

    expect(settlement.settlePayment).toHaveBeenCalledWith('OID2', {
      kind: 'failure',
      failureCode: '99',
      failureMessage: 'do_not_honor',
    });
  });

  it('leaves still-pending rows alone (no settlement call)', async () => {
    prisma.subscriptionPayment.findMany.mockResolvedValue([
      { id: 'pay-3', paytrMerchantOid: 'OID3' },
    ] as any);
    paytr.inquiryStatus.mockResolvedValue({ status: 'pending', raw: {} });

    await svc.handlePaytrPendingRecovery();

    expect(settlement.settlePayment).not.toHaveBeenCalled();
  });

  it('returns early without querying PayTR when no rows are stuck', async () => {
    prisma.subscriptionPayment.findMany.mockResolvedValue([] as any);

    await svc.handlePaytrPendingRecovery();

    expect(paytr.inquiryStatus).not.toHaveBeenCalled();
    expect(settlement.settlePayment).not.toHaveBeenCalled();
  });

  it('caps the batch at 50 rows per run to bound PayTR API spend', async () => {
    prisma.subscriptionPayment.findMany.mockResolvedValue([] as any);

    await svc.handlePaytrPendingRecovery();

    expect(prisma.subscriptionPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });
});

/**
 * handlePendingCancellations: at-period-end cancellations need to emit
 * subscription.cancelled.v1 so the entitlement projector revokes grants
 * the moment the paid window closes — a bare updateMany was silent and
 * left tenants on premium features until the next ad-hoc reprojection.
 */
describe('SubscriptionSchedulerService.handlePendingCancellations', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: SubscriptionSchedulerService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('outbox-id') };
    svc = buildSvc(prisma, {}, {}, undefined, outbox);
    // v2.8.89: handlePendingCancellations now wraps the updateMany +
    // tenant.updateMany in $transaction. Pass-through callback so the
    // inner result flows out.
    prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 'free-plan' } as any);
    prisma.tenant.updateMany.mockResolvedValue({ count: 1 } as any);
  });

  it('emits subscription.cancelled.v1 with reason=period_end_cancel for each expiring row', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      { id: 'sub-1', tenantId: 'tenant-1', plan: { name: 'STARTER' } },
      { id: 'sub-2', tenantId: 'tenant-2', plan: { name: 'PRO' } },
    ] as any);
    prisma.subscription.updateMany.mockResolvedValue({ count: 2 } as any);

    await svc.handlePendingCancellations();

    expect(outbox.append).toHaveBeenCalledTimes(2);
    // v2.8.94 — outbox.append now also receives a second arg (the tx
    // client) because the emit runs inside the $transaction. The mock
    // happens to receive `undefined` for tx because jest-mock-extended's
    // mockDeep doesn't forward the $transaction callback's tx through
    // mockImplementation cleanly; we still verify the payload shape
    // here and leave the atomicity guarantee to integration tests.
    const calls = outbox.append.mock.calls;
    expect(calls[0][0]).toEqual({
      type: 'subscription.cancelled.v1',
      tenantId: 'tenant-1',
      payload: {
        subscriptionId: 'sub-1',
        tenantId: 'tenant-1',
        planCode: 'STARTER',
        reason: 'period_end_cancel',
      },
    });
    expect(calls[1][0]).toEqual({
      type: 'subscription.cancelled.v1',
      tenantId: 'tenant-2',
      payload: {
        subscriptionId: 'sub-2',
        tenantId: 'tenant-2',
        planCode: 'PRO',
        reason: 'period_end_cancel',
      },
    });
  });

  it('short-circuits without calling updateMany when no rows expire', async () => {
    prisma.subscription.findMany.mockResolvedValue([] as any);

    await svc.handlePendingCancellations();

    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });
});
