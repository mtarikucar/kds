import { ReferralService } from './referral.service';
import { LoyaltyService } from './loyalty.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/** Minimal ConfigService stub honouring the (key, default) signature. */
function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn((key: string, def?: unknown) =>
      key in overrides ? overrides[key] : def,
    ),
  } as any;
}

/**
 * Iter-80 regression for ReferralService listing surfaces.
 *
 * Before this iter:
 *  - getReferralStats did an unbounded findMany. A super-engaged
 *    influencer customer with hundreds of referrals would pull every
 *    row (each carrying the referred customer's name) on every
 *    QR-menu profile load.
 *  - getTenantReferrals existed with NO callers and would have
 *    returned an unbounded list with phone PII on both referrer +
 *    referred sides. Dead-code resurrection risk.
 *
 * iter-80 caps the stats page at 200, fans the count() / aggregate
 * out so the visible totals stay canonical, and deletes
 * getTenantReferrals entirely.
 */
describe('ReferralService.getReferralStats (iter-80)', () => {
  let prisma: MockPrismaClient;
  let loyalty: jest.Mocked<LoyaltyService>;
  let svc: ReferralService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    loyalty = {} as any;
    svc = new ReferralService(prisma as any, loyalty, makeConfig());
    // findFirst for the customer existence check.
    (prisma.customer.findFirst as any).mockResolvedValue({ referralCode: 'ALICE12AB' });
    // $transaction([findMany, count, aggregate]) — pass through as a
    // batched array call.
    (prisma.$transaction as any).mockImplementation(async (ops: any[]) => Promise.all(ops));
  });

  it('caps the referrals listing at 200 (PII payload bound on the QR-menu profile page)', async () => {
    let captured: any = null;
    (prisma.customerReferral.findMany as any).mockImplementation(async (args: any) => {
      captured = args;
      return [];
    });
    (prisma.customerReferral.count as any).mockResolvedValue(0);
    (prisma.customerReferral.aggregate as any).mockResolvedValue({ _sum: { referrerReward: 0 } });

    await svc.getReferralStats('c-1', 't-1');

    expect(captured.take).toBe(200);
  });

  it('keeps totalReferrals canonical via a separate count() (not list.length)', async () => {
    (prisma.customerReferral.findMany as any).mockResolvedValue([
      { id: 'r1', referred: { name: 'A' }, status: 'COMPLETED', referrerReward: 100, createdAt: new Date(), completedAt: new Date(), rewardedAt: new Date() },
    ]);
    // Pretend the customer has 1,500 referrals across history.
    (prisma.customerReferral.count as any).mockResolvedValue(1500);
    (prisma.customerReferral.aggregate as any).mockResolvedValue({ _sum: { referrerReward: 150_000 } });

    const stats = await svc.getReferralStats('c-1', 't-1');

    // Visible page (returned `referrals` array) is the capped slice.
    expect(stats.referrals).toHaveLength(1);
    // Aggregate totals stay canonical even though the listing is capped.
    expect(stats.totalReferrals).toBe(1500);
    expect(stats.totalPointsEarned).toBe(150_000);
  });

  it('treats null aggregate sum as 0 (no rewarded referrals yet)', async () => {
    (prisma.customerReferral.findMany as any).mockResolvedValue([]);
    (prisma.customerReferral.count as any).mockResolvedValue(0);
    (prisma.customerReferral.aggregate as any).mockResolvedValue({ _sum: { referrerReward: null } });

    const stats = await svc.getReferralStats('c-1', 't-1');

    expect(stats.totalPointsEarned).toBe(0);
  });

  it('getTenantReferrals is no longer exposed (dead code removed in iter-80)', () => {
    // The method existed pre-iter-80 with no callers and unbounded
    // findMany returning phone PII. Deleted so a future admin route
    // can't silently route through the unbounded listing without
    // first re-implementing pagination + role gates + maskPhone.
    expect((svc as any).getTenantReferrals).toBeUndefined();
  });
});

describe('ReferralService.generateReferralCode maxAttempts config', () => {
  let prisma: MockPrismaClient;
  let loyalty: jest.Mocked<LoyaltyService>;

  /**
   * Drive generateReferralCode into perpetual collision: the customer has no
   * code yet (first findFirst), and every post-update read returns a null
   * code so neither early-return fires and the loop exhausts its budget.
   */
  function wirePerpetualCollision() {
    let call = 0;
    (prisma.customer.findFirst as any).mockImplementation(async () => {
      call += 1;
      // First call = existence/gate check (no existing code yet).
      if (call === 1) return { name: 'Alice', referralCode: null };
      // Subsequent calls = post-update reads; never the code we wrote.
      return { referralCode: null };
    });
    (prisma.customer.updateMany as any).mockResolvedValue({ count: 0 });
  }

  beforeEach(() => {
    prisma = mockPrismaClient();
    loyalty = {} as any;
  });

  it('defaults to 10 attempts when REFERRAL_CODE_MAX_ATTEMPTS is unset (behavior unchanged)', async () => {
    const svc = new ReferralService(prisma as any, loyalty, makeConfig());
    wirePerpetualCollision();

    await expect(svc.generateReferralCode('c-1', 't-1')).rejects.toThrow(
      /Failed to generate unique referral code/,
    );
    // One updateMany per attempt -> the default budget of 10.
    expect((prisma.customer.updateMany as any).mock.calls).toHaveLength(10);
  });

  it('honours a REFERRAL_CODE_MAX_ATTEMPTS override', async () => {
    const svc = new ReferralService(
      prisma as any,
      loyalty,
      makeConfig({ REFERRAL_CODE_MAX_ATTEMPTS: 3 }),
    );
    wirePerpetualCollision();

    await expect(svc.generateReferralCode('c-1', 't-1')).rejects.toThrow(
      /Failed to generate unique referral code/,
    );
    expect((prisma.customer.updateMany as any).mock.calls).toHaveLength(3);
  });
});
