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

    // Idempotency MUST happen inside the same Serializable txn that
    // writes the credit — exactly the bug awardWelcomeBonus above was
    // fixed for in iter-X. Two concurrent earnPointsFromOrder calls
    // (the PayTR webhook racing with the recovery cron, or a fast
    // settlement retry) both saw existing=null when the read was
    // outside the txn, both fell through to awardPoints, and the
    // customer got DOUBLE points for one sale. Wrapping the dedup
    // read in the same Serializable txn makes the loser see the
    // winner's INSERT and short-circuit.
    const txResult = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.loyaltyTransaction.findFirst({
        where: {
          customerId,
          orderId,
          type: LoyaltyTransactionType.EARNED,
          customer: { tenantId },
        },
      });
      if (existing) {
        const cust = await tx.customer.findFirst({
          where: { id: customerId, tenantId },
          select: { loyaltyPoints: true },
        });
        return { transaction: existing, newBalance: cust?.loyaltyPoints ?? 0, didCredit: false };
      }
      if (points <= 0) {
        const cust = await tx.customer.findFirst({
          where: { id: customerId, tenantId },
          select: { loyaltyPoints: true },
        });
        return { transaction: null, newBalance: cust?.loyaltyPoints ?? 0, didCredit: false };
      }

      // Inline the awardPoints write path — calling out to it would
      // start a nested $transaction, which Prisma handles but defeats
      // the in-txn dedup guarantee above. Pre-iter-37 the outer
      // findFirst was outside the txn AND awardPoints opened its own
      // — the dedup never saw the winner.
      const customer = await tx.customer.findFirst({
        where: { id: customerId, tenantId },
      });
      if (!customer) throw new BadRequestException('Customer not found');
      const balanceBefore = customer.loyaltyPoints;
      const balanceAfter = balanceBefore + points;

      await tx.customer.updateMany({
        where: { id: customerId, tenantId },
        data: { loyaltyPoints: { increment: points } },
      });
      const transaction = await tx.loyaltyTransaction.create({
        data: {
          tenantId,
          customerId,
          type: LoyaltyTransactionType.EARNED,
          points,
          description: `Earned ${points} points from order ${orderNumber}`,
          orderId,
          orderNumber,
          orderAmount: orderAmount as any,
          balanceBefore,
          balanceAfter,
        },
      });
      return { transaction, newBalance: balanceAfter, didCredit: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // Tier promotion outside the txn — it only ever moves UPWARD
    // (lifetimePoints is sum-of-positive entries; refunds/redemptions
    // are negative so don't affect it), and the compound-WHERE
    // updateMany inside checkAndUpgradeTier is its own race guard.
    // Skipping when we didn't actually credit avoids an unnecessary
    // aggregate query on idempotent retries.
    let tierUpgrade: { upgraded: boolean; oldTier: LoyaltyTier; newTier: LoyaltyTier } | null = null;
    if (txResult.didCredit) {
      const tierResult = await this.checkAndUpgradeTier(customerId, tenantId).catch(() => null);
      tierUpgrade = tierResult?.upgraded ? (tierResult as any) : null;
    }
    return {
      transaction: txResult.transaction,
      newBalance: txResult.newBalance,
      tierUpgrade,
    };
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
    // Idempotency: at most one welcome BONUS per customer. The previous
    // implementation did the `findFirst` *outside* a transaction and then
    // called `awardPoints` (which has its own tx) — two concurrent
    // /identify taps could both see "no bonus yet" and both credit,
    // producing duplicate welcome gifts. Wrap check + create in one
    // Serializable tx so the second arrival sees the first's write.
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.loyaltyTransaction.findFirst({
        where: {
          customerId,
          type: LoyaltyTransactionType.BONUS,
          description: { startsWith: 'Welcome bonus:' },
          customer: { tenantId },
        },
      });
      if (existing) {
        const customer = await tx.customer.findFirst({
          where: { id: customerId, tenantId },
          select: { loyaltyPoints: true },
        });
        return { transaction: existing, newBalance: customer?.loyaltyPoints ?? 0 };
      }

      const customer = await tx.customer.findFirst({
        where: { id: customerId, tenantId },
      });
      if (!customer) throw new BadRequestException('Customer not found');

      const points = LOYALTY_CONFIG.welcomeBonus;
      const balanceBefore = customer.loyaltyPoints;
      const balanceAfter = balanceBefore + points;

      await tx.customer.updateMany({
        where: { id: customerId, tenantId },
        data: { loyaltyPoints: { increment: points } },
      });

      const transaction = await tx.loyaltyTransaction.create({
        data: {
          tenantId,
          customerId,
          type: LoyaltyTransactionType.BONUS,
          points,
          description: `Welcome bonus: ${points} points`,
          balanceBefore,
          balanceAfter,
        },
      });

      return { transaction, newBalance: balanceAfter };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
      // Compound WHERE on the observed tier guards two parallel orders
      // that both cross the threshold from each declaring an upgrade.
      // The first wins (count=1, caller fires the upgrade email), the
      // second sees count=0 and returns upgraded=false — so the
      // customer only gets one "Welcome to GOLD" message, not two.
      const claim = await this.prisma.customer.updateMany({
        where: { id: customerId, tenantId, loyaltyTier: currentTier },
        data: { loyaltyTier: calculatedTier },
      });
      if (claim.count === 0) {
        return { upgraded: false, newTier: calculatedTier };
      }
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

    // The earlier `type as LoyaltyTransactionType` silently accepted
    // any string and persisted it. The `type` column then carried
    // typo'd or invented values (`"earnd"`, `"adjustment"` lowercase,
    // anything an internal caller passed), breaking the audit-trail
    // filters in checkAndUpgradeTier and getLoyaltyStats which group
    // by the canonical enum names. Reject here so the wiring bug
    // surfaces at the call site, not in the analytics aggregate.
    if (!Object.values(LoyaltyTransactionType).includes(type as LoyaltyTransactionType)) {
      throw new BadRequestException(
        `Invalid loyalty transaction type "${type}". Expected one of: ${Object.values(LoyaltyTransactionType).join(', ')}`,
      );
    }

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
