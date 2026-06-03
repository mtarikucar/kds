import { ReferralDirectoryService } from './referral-directory.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * The referral resolve seam. CORE (payments) calls this to snapshot referral
 * attribution at checkout without reading marketing_users itself. The contract
 * is strict: unknown / inactive / blank codes resolve to null and never throw,
 * so a bad code can never block a checkout.
 */
describe('ReferralDirectoryService', () => {
  let prisma: MockPrismaClient;
  let svc: ReferralDirectoryService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new ReferralDirectoryService(prisma as any);
  });

  it('resolves an ACTIVE marketer code to its ids', async () => {
    prisma.marketingUser.findUnique.mockResolvedValue({
      id: 'm-1',
      referralCode: 'AHMET42',
      status: 'ACTIVE',
    } as any);

    await expect(svc.resolveReferralCode('AHMET42')).resolves.toEqual({
      marketingUserId: 'm-1',
      referralCode: 'AHMET42',
    });
    expect(prisma.marketingUser.findUnique).toHaveBeenCalledWith({
      where: { referralCode: 'AHMET42' },
      select: { id: true, referralCode: true, status: true },
    });
  });

  it('returns null for an unknown code', async () => {
    prisma.marketingUser.findUnique.mockResolvedValue(null as any);
    await expect(svc.resolveReferralCode('NOPE')).resolves.toBeNull();
  });

  it('returns null for an INACTIVE marketer', async () => {
    prisma.marketingUser.findUnique.mockResolvedValue({
      id: 'm-2',
      referralCode: 'OLD1',
      status: 'INACTIVE',
    } as any);
    await expect(svc.resolveReferralCode('OLD1')).resolves.toBeNull();
  });

  it('returns null for blank/whitespace input without hitting the DB', async () => {
    await expect(svc.resolveReferralCode('   ')).resolves.toBeNull();
    await expect(svc.resolveReferralCode('')).resolves.toBeNull();
    expect(prisma.marketingUser.findUnique).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace before lookup', async () => {
    prisma.marketingUser.findUnique.mockResolvedValue({
      id: 'm-3',
      referralCode: 'CODE9',
      status: 'ACTIVE',
    } as any);
    await svc.resolveReferralCode('  CODE9  ');
    expect(prisma.marketingUser.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { referralCode: 'CODE9' } }),
    );
  });
});
