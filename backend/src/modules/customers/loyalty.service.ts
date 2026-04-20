import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export enum LoyaltyTransactionType {
  EARNED = 'EARNED',
  REDEEMED = 'REDEEMED',
  EXPIRED = 'EXPIRED',
  ADJUSTMENT = 'ADJUSTMENT',
  BONUS = 'BONUS',
  REFERRAL = 'REFERRAL',
}

export enum LoyaltyTier {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
}

const LOYALTY_CONFIG = {
  pointsPerCurrencyUnit: 1,
  currencyPerPoint: new Prisma.Decimal('0.1'),
  minRedeemPoints: 100,
  welcomeBonus: 50,
  birthdayBonus: 100,
  tiers: {
    BRONZE: { threshold: 0, multiplier: 1.0, name: 'Bronze' },
    SILVER: { threshold: 500, multiplier: 1.25, name: 'Silver' },
    GOLD: { threshold: 2000, multiplier: 1.5, name: 'Gold' },
    PLATINUM: { threshold: 5000, multiplier: 2.0, name: 'Platinum' },
  },
};

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Award (or deduct, for redemption) points atomically. The balance check +
   * update + transaction insert run inside a single Serializable `$transaction`
   * so two concurrent calls cannot both read balance N and both decrement:
   * - For positive delta (award), no balance gate is needed.
   * - For negative delta (redemption), we use a conditional `updateMany`
   *   where loyaltyPoints >= |delta|; if another caller drained the balance,
   *   count === 0 and we raise BadRequestException.
   */
  async awardPoints(
    customerId: string,
    tenantId: string,
    points: number,
    type: LoyaltyTransactionType,
    description: string,
    metadata?: { orderId?: string; orderNumber?: string; orderAmount?: number | Prisma.Decimal },
  ) {
    if (!Number.isInteger(points) || points === 0) {
      throw new BadRequestException('points must be a non-zero integer');
    }

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, tenantId },
      });
      if (!customer) throw new BadRequestException('Customer not found');

      const balanceBefore = customer.loyaltyPoints;
      const balanceAfter = balanceBefore + points;

      if (points < 0) {
        const needed = -points;
        if (balanceBefore < needed) {
          throw new BadRequestException('Insufficient loyalty points');
        }
        const result = await tx.customer.updateMany({
          where: { id: customerId, tenantId, loyaltyPoints: { gte: needed } },
          data: { loyaltyPoints: { decrement: needed } },
        });
        if (result.count !== 1) {
          throw new BadRequestException('Insufficient loyalty points (race)');
        }
      } else {
        await tx.customer.updateMany({
          where: { id: customerId, tenantId },
          data: { loyaltyPoints: { increment: points } },
        });
      }

      const transaction = await tx.loyaltyTransaction.create({
        data: {
          tenantId,
          customerId,
          type,
          points,
          description,
          orderId: metadata?.orderId,
          orderNumber: metadata?.orderNumber,
          orderAmount: metadata?.orderAmount as any,
          balanceBefore,
          balanceAfter,
          metadata: metadata ? { additional: metadata as any } : undefined,
        },
      });

      return { transaction, newBalance: balanceAfter };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async earnPointsFromOrder(
    customerId: string,
    tenantId: string,
    orderId: string,
    orderNumber: string,
    orderAmount: number,
  ) {
    const points = Math.floor(orderAmount * LOYALTY_CONFIG.pointsPerCurrencyUnit);
    return this.awardPoints(
      customerId,
      tenantId,
      points,
      LoyaltyTransactionType.EARNED,
      `Earned ${points} points from order ${orderNumber}`,
      { orderId, orderNumber, orderAmount },
    );
  }

  async redeemPoints(
    customerId: string,
    tenantId: string,
    pointsToRedeem: number,
    orderId?: string,
    orderNumber?: string,
  ) {
    if (pointsToRedeem < LOYALTY_CONFIG.minRedeemPoints) {
      throw new BadRequestException(
        `Minimum ${LOYALTY_CONFIG.minRedeemPoints} points required to redeem`,
      );
    }

    const discountAmount = LOYALTY_CONFIG.currencyPerPoint.mul(pointsToRedeem);

    const result = await this.awardPoints(
      customerId,
      tenantId,
      -pointsToRedeem,
      LoyaltyTransactionType.REDEEMED,
      `Redeemed ${pointsToRedeem} points for ${discountAmount.toString()} discount`,
      { orderId, orderNumber, orderAmount: discountAmount },
    );

    return { ...result, discountAmount: discountAmount.toNumber() };
  }

  async awardWelcomeBonus(customerId: string, tenantId: string) {
    return this.awardPoints(
      customerId,
      tenantId,
      LOYALTY_CONFIG.welcomeBonus,
      LoyaltyTransactionType.BONUS,
      `Welcome bonus: ${LOYALTY_CONFIG.welcomeBonus} points`,
    );
  }

  async awardBirthdayBonus(customerId: string, tenantId: string) {
    return this.awardPoints(
      customerId,
      tenantId,
      LOYALTY_CONFIG.birthdayBonus,
      LoyaltyTransactionType.BONUS,
      `Birthday bonus: ${LOYALTY_CONFIG.birthdayBonus} points`,
    );
  }

  async getTransactionHistory(customerId: string, tenantId: string, limit = 50) {
    // Tenant-scoped via relation filter to block cross-tenant probing by
    // guessed customerId.
    return this.prisma.loyaltyTransaction.findMany({
      where: { customerId, customer: { tenantId } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  async getBalance(customerId: string, tenantId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { loyaltyPoints: true },
    });
    if (!customer) throw new BadRequestException('Customer not found');

    const redeemable = LOYALTY_CONFIG.currencyPerPoint.mul(customer.loyaltyPoints);
    return {
      points: customer.loyaltyPoints,
      redeemableAmount: redeemable.toNumber(),
      canRedeem: customer.loyaltyPoints >= LOYALTY_CONFIG.minRedeemPoints,
      minRedeemPoints: LOYALTY_CONFIG.minRedeemPoints,
    };
  }

  async getLoyaltyStats(tenantId: string) {
    const [totalsAgg, earnedAgg, redeemedAgg] = await this.prisma.$transaction([
      this.prisma.customer.aggregate({
        where: { tenantId, loyaltyPoints: { gt: 0 } },
        _count: { _all: true },
        _sum: { loyaltyPoints: true },
        _avg: { loyaltyPoints: true },
      }),
      this.prisma.loyaltyTransaction.aggregate({
        where: { customer: { tenantId }, type: LoyaltyTransactionType.EARNED },
        _sum: { points: true },
      }),
      this.prisma.loyaltyTransaction.aggregate({
        where: { customer: { tenantId }, type: LoyaltyTransactionType.REDEEMED },
        _sum: { points: true },
      }),
    ]);

    const pointsEarned = earnedAgg._sum.points ?? 0;
    const pointsRedeemed = Math.abs(redeemedAgg._sum.points ?? 0);

    return {
      totalCustomersWithPoints: totalsAgg._count._all,
      totalPointsIssued: totalsAgg._sum.loyaltyPoints ?? 0,
      avgPointsPerCustomer: Math.round(totalsAgg._avg.loyaltyPoints ?? 0),
      pointsEarned,
      pointsRedeemed,
      redemptionRate: pointsEarned > 0 ? (pointsRedeemed / pointsEarned) * 100 : 0,
    };
  }

  calculateTier(lifetimePoints: number): LoyaltyTier {
    if (lifetimePoints >= LOYALTY_CONFIG.tiers.PLATINUM.threshold) return LoyaltyTier.PLATINUM;
    if (lifetimePoints >= LOYALTY_CONFIG.tiers.GOLD.threshold) return LoyaltyTier.GOLD;
    if (lifetimePoints >= LOYALTY_CONFIG.tiers.SILVER.threshold) return LoyaltyTier.SILVER;
    return LoyaltyTier.BRONZE;
  }

  getTierInfo(tier: LoyaltyTier) {
    return LOYALTY_CONFIG.tiers[tier];
  }

  async checkAndUpgradeTier(customerId: string, tenantId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true, loyaltyTier: true },
    });
    if (!customer) throw new BadRequestException('Customer not found');

    const lifetimeAgg = await this.prisma.loyaltyTransaction.aggregate({
      where: { customerId, customer: { tenantId }, points: { gt: 0 } },
      _sum: { points: true },
    });
    const lifetimePoints = lifetimeAgg._sum.points ?? 0;
    const calculatedTier = this.calculateTier(lifetimePoints);
    const currentTier = customer.loyaltyTier as LoyaltyTier;

    const order = [LoyaltyTier.BRONZE, LoyaltyTier.SILVER, LoyaltyTier.GOLD, LoyaltyTier.PLATINUM];
    if (order.indexOf(calculatedTier) > order.indexOf(currentTier)) {
      await this.prisma.customer.updateMany({
        where: { id: customerId, tenantId },
        data: { loyaltyTier: calculatedTier },
      });
      this.logger.log(`Customer ${customerId} upgraded from ${currentTier} to ${calculatedTier}`);
      return { upgraded: true, oldTier: currentTier, newTier: calculatedTier };
    }
    return { upgraded: false, newTier: currentTier };
  }

  async getTierStatus(customerId: string, tenantId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { loyaltyTier: true },
    });
    if (!customer) throw new BadRequestException('Customer not found');

    const lifetimeAgg = await this.prisma.loyaltyTransaction.aggregate({
      where: { customerId, customer: { tenantId }, points: { gt: 0 } },
      _sum: { points: true },
    });
    const lifetimePoints = lifetimeAgg._sum.points ?? 0;
    const currentTier = customer.loyaltyTier as LoyaltyTier;
    const currentTierInfo = this.getTierInfo(currentTier);

    const order = [LoyaltyTier.BRONZE, LoyaltyTier.SILVER, LoyaltyTier.GOLD, LoyaltyTier.PLATINUM];
    const nextIdx = order.indexOf(currentTier) + 1;
    const nextTier = nextIdx < order.length ? order[nextIdx] : null;
    const nextTierInfo = nextTier ? this.getTierInfo(nextTier) : null;

    return {
      currentTier,
      currentTierInfo,
      lifetimePoints,
      nextTier,
      nextTierInfo,
      pointsToNextTier: nextTierInfo ? nextTierInfo.threshold - lifetimePoints : 0,
      progressPercentage: nextTierInfo
        ? Math.min(100, (lifetimePoints / nextTierInfo.threshold) * 100)
        : 100,
    };
  }

  async addPoints(params: {
    customerId: string;
    tenantId: string;
    points: number;
    type: string;
    description: string;
    source: string;
    metadata?: any;
  }) {
    const { customerId, tenantId, points, type, description, metadata } = params;
    const result = await this.awardPoints(
      customerId,
      tenantId,
      points,
      type as LoyaltyTransactionType,
      description,
      metadata,
    );
    const tierResult = await this.checkAndUpgradeTier(customerId, tenantId);
    return { ...result, tierUpgrade: tierResult.upgraded ? tierResult : null };
  }

  getLoyaltyConfig() {
    return {
      pointsPerCurrencyUnit: LOYALTY_CONFIG.pointsPerCurrencyUnit,
      currencyPerPoint: LOYALTY_CONFIG.currencyPerPoint.toNumber(),
      minRedeemPoints: LOYALTY_CONFIG.minRedeemPoints,
      welcomeBonus: LOYALTY_CONFIG.welcomeBonus,
      birthdayBonus: LOYALTY_CONFIG.birthdayBonus,
      tiers: LOYALTY_CONFIG.tiers,
    };
  }
}
