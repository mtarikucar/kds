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
