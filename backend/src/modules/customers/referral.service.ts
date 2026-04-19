import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LoyaltyService } from './loyalty.service';
import { generateReferralSuffix } from './customers.helpers';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  // Loyalty payouts for a successful, phone-verified referral. Raising these
  // without also raising the daily-cap / verification gates will make this
  // endpoint economically attractive to farm.
  private readonly REFERRER_BONUS = 100;
  private readonly REFERRED_BONUS = 50;
  private readonly DAILY_TENANT_CAP = 200;

  constructor(
    private prisma: PrismaService,
    private loyaltyService: LoyaltyService,
  ) {}

  async generateReferralCode(customerId: string, tenantId: string): Promise<string> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { name: true, referralCode: true },
    });
    if (!customer) throw new BadRequestException('Customer not found');
    if (customer.referralCode) return customer.referralCode;

    const maxAttempts = 10;
    for (let i = 0; i < maxAttempts; i++) {
      const namePart = customer.name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .substring(0, 4)
        .padEnd(4, 'X');
      const code = `${namePart}${generateReferralSuffix(4)}`;

      try {
        await this.prisma.customer.updateMany({
          where: { id: customerId, tenantId, referralCode: null },
          data: { referralCode: code },
        });
        const updated = await this.prisma.customer.findFirst({
          where: { id: customerId, tenantId },
          select: { referralCode: true },
        });
        if (updated?.referralCode === code) return code;
        if (updated?.referralCode) return updated.referralCode;
      } catch (err) {
        if (
          !(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        ) {
          throw err;
        }
      }
    }
    throw new ConflictException('Failed to generate unique referral code');
  }

  /**
   * Apply a referral code. Caller must supply `referredCustomerId` derived
   * from the session (NOT from the request body) and the customer's phone
   * must already be verified. The whole flow runs in one transaction so a
   * mid-flight failure cannot leave the referred customer flagged without
   * the loyalty points being credited.
   */
  async applyReferralCode(
    referredCustomerId: string,
    referralCode: string,
    tenantId: string,
  ): Promise<{
    success: boolean;
    referrer: { id: string; name: string };
    bonusAwarded: boolean;
  }> {
    const code = referralCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,32}$/.test(code)) {
      throw new BadRequestException('Invalid referral code');
    }

    // Per-tenant daily cap on referral grants to cap loyalty-point farming.
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60_000);
    const todayCount = await this.prisma.customerReferral.count({
      where: {
        referrer: { tenantId },
        createdAt: { gte: oneDayAgo },
      },
    });
    if (todayCount >= this.DAILY_TENANT_CAP) {
      throw new ForbiddenException('Daily referral limit reached');
    }

    return this.prisma.$transaction(async (tx) => {
      const referrer = await tx.customer.findFirst({
        where: { referralCode: code, tenantId },
        select: { id: true, name: true },
      });
      if (!referrer) throw new BadRequestException('Invalid referral code');

      const referredCustomer = await tx.customer.findFirst({
        where: { id: referredCustomerId, tenantId },
        select: {
          id: true,
          referredBy: true,
          phoneVerified: true,
          totalOrders: true,
        },
      });
      if (!referredCustomer) throw new BadRequestException('Customer not found');

      if (!referredCustomer.phoneVerified) {
        throw new ForbiddenException('Phone must be verified before applying a referral code');
      }
      if (referredCustomer.referredBy) {
        throw new BadRequestException('Customer has already used a referral code');
      }
      if (referrer.id === referredCustomerId) {
        throw new BadRequestException('You cannot use your own referral code');
      }

      const referral = await tx.customerReferral.create({
        data: {
          referrerId: referrer.id,
          referredId: referredCustomerId,
          referralCode: code,
          status: 'COMPLETED',
          referrerReward: this.REFERRER_BONUS,
          referredReward: this.REFERRED_BONUS,
          completedAt: new Date(),
        },
      });

      const flagResult = await tx.customer.updateMany({
        where: { id: referredCustomerId, tenantId, referredBy: null },
        data: { referredBy: code },
      });
      if (flagResult.count !== 1) {
        throw new ConflictException('Referral already applied');
      }

      // Inline loyalty mutations to keep the whole flow atomic. These use
      // the same pattern as LoyaltyService.awardPoints but against the tx
      // client.
      const awardInTx = async (customerId: string, points: number, description: string) => {
        const customer = await tx.customer.findFirstOrThrow({
          where: { id: customerId, tenantId },
        });
        const before = customer.loyaltyPoints;
        const after = before + points;
        await tx.customer.updateMany({
          where: { id: customerId, tenantId },
          data: { loyaltyPoints: { increment: points } },
        });
        await tx.loyaltyTransaction.create({
          data: {
            customerId,
            type: 'REFERRAL',
            points,
            description,
            balanceBefore: before,
            balanceAfter: after,
            metadata: { additional: { referralId: referral.id } } as any,
          },
        });
      };

      if (this.REFERRER_BONUS > 0) {
        await awardInTx(
          referrer.id,
          this.REFERRER_BONUS,
          `Referral bonus for referring customer`,
        );
      }
      if (this.REFERRED_BONUS > 0) {
        await awardInTx(
          referredCustomerId,
          this.REFERRED_BONUS,
          `Welcome bonus for using referral code ${code}`,
        );
      }

      await tx.customerReferral.update({
        where: { id: referral.id },
        data: { rewardedAt: new Date() },
      });

      return {
        success: true,
        referrer: { id: referrer.id, name: referrer.name },
        bonusAwarded: true,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async getReferralStats(customerId: string, tenantId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { referralCode: true },
    });
    if (!customer) throw new BadRequestException('Customer not found');

    const referrals = await this.prisma.customerReferral.findMany({
      where: { referrerId: customerId, referrer: { tenantId } },
      include: { referred: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const totalPointsEarned = referrals
      .filter((r) => r.rewardedAt)
      .reduce((sum, r) => sum + r.referrerReward, 0);

    return {
      referralCode: customer.referralCode || '',
      totalReferrals: referrals.length,
      totalPointsEarned,
      referrals: referrals.map((r) => ({
        id: r.id,
        customerName: r.referred.name,
        status: r.status,
        pointsEarned: r.referrerReward,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      })),
    };
  }

  async getTenantReferrals(tenantId: string) {
    return this.prisma.customerReferral.findMany({
      where: { referrer: { tenantId } },
      include: {
        referrer: { select: { id: true, name: true, phone: true } },
        referred: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
