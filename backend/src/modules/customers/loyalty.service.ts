import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export enum LoyaltyTransactionType {
  EARNED = 'EARNED',
  REDEEMED = 'REDEEMED',
  EXPIRED = 'EXPIRED',
  ADJUSTMENT = 'ADJUSTMENT',
  BONUS = 'BONUS',
}

// Loyalty program configuration
const LOYALTY_CONFIG = {
  // Points earned per currency unit spent
  pointsPerCurrencyUnit: 1, // 1 point per ₺1 or $1

  // Currency value per point when redeeming
  currencyPerPoint: 0.1, // 100 points = ₺10 or $10

  // Minimum points required to redeem
  minRedeemPoints: 100,

  // Welcome bonus for new customers
  welcomeBonus: 50,

  // Birthday bonus points
  birthdayBonus: 100,
};

@Injectable()
export class LoyaltyService {
  constructor(private prisma: PrismaService) {}

  // ========================================
  // POINTS MANAGEMENT
  // ========================================

  async awardPoints(
    customerId: string,
    points: number,
    type: LoyaltyTransactionType,
    description: string,
    metadata?: {
      orderId?: string;
      orderNumber?: string;
      orderAmount?: number;
    },
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

    const balanceBefore = customer.loyaltyPoints;
    const balanceAfter = balanceBefore + points;

    // Create transaction record
    const transaction = await this.prisma.loyaltyTransaction.create({
      data: {
        customerId,
        type,
        points,
        description,
        orderId: metadata?.orderId,
        orderNumber: metadata?.orderNumber,
        orderAmount: metadata?.orderAmount,
        balanceBefore,
        balanceAfter,
        metadata: metadata ? { additional: metadata } : undefined,
      },
    });

    // Update customer's loyalty points
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { loyaltyPoints: balanceAfter },
    });

    return {
      transaction,
      newBalance: balanceAfter,
    };
  }

  async earnPointsFromOrder(customerId: string, orderId: string, orderNumber: string, orderAmount: number) {
    const points = Math.floor(orderAmount * LOYALTY_CONFIG.pointsPerCurrencyUnit);

    return this.awardPoints(
      customerId,
      points,
      LoyaltyTransactionType.EARNED,
      `Earned ${points} points from order ${orderNumber}`,
      {
        orderId,
        orderNumber,
        orderAmount,
      },
    );
  }

  async redeemPoints(customerId: string, pointsToRedeem: number, orderId?: string, orderNumber?: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

    // Validate redemption
    if (pointsToRedeem < LOYALTY_CONFIG.minRedeemPoints) {
      throw new BadRequestException(
        `Minimum ${LOYALTY_CONFIG.minRedeemPoints} points required to redeem`,
      );
    }

    if (customer.loyaltyPoints < pointsToRedeem) {
      throw new BadRequestException('Insufficient loyalty points');
    }

    // Calculate discount amount
    const discountAmount = pointsToRedeem * LOYALTY_CONFIG.currencyPerPoint;

    // Create redemption transaction
    const result = await this.awardPoints(
      customerId,
      -pointsToRedeem, // Negative for redemption
      LoyaltyTransactionType.REDEEMED,
      `Redeemed ${pointsToRedeem} points for ${discountAmount} discount`,
      {
        orderId,
        orderNumber,
        orderAmount: discountAmount,
      },
    );

    return {
      ...result,
      discountAmount,
    };
  }

  async awardWelcomeBonus(customerId: string) {
    return this.awardPoints(
      customerId,
      LOYALTY_CONFIG.welcomeBonus,
      LoyaltyTransactionType.BONUS,
      `Welcome bonus: ${LOYALTY_CONFIG.welcomeBonus} points`,
    );
  }

  async awardBirthdayBonus(customerId: string) {
    return this.awardPoints(
      customerId,
      LOYALTY_CONFIG.birthdayBonus,
      LoyaltyTransactionType.BONUS,
      `Birthday bonus: ${LOYALTY_CONFIG.birthdayBonus} points`,
    );
  }

  // ========================================
  // TRANSACTION HISTORY
  // ========================================

  async getTransactionHistory(customerId: string, limit = 50) {
    return this.prisma.loyaltyTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getBalance(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { loyaltyPoints: true },
    });

    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

    return {
      points: customer.loyaltyPoints,
      redeemableAmount: customer.loyaltyPoints * LOYALTY_CONFIG.currencyPerPoint,
      canRedeem: customer.loyaltyPoints >= LOYALTY_CONFIG.minRedeemPoints,
      minRedeemPoints: LOYALTY_CONFIG.minRedeemPoints,
    };
  }

  // ========================================
  // ANALYTICS
  // ========================================

  async getLoyaltyStats(tenantId: string) {
    // Get all customers with loyalty points
    const customers = await this.prisma.customer.findMany({
      where: { tenantId, loyaltyPoints: { gt: 0 } },
      select: { loyaltyPoints: true },
    });

    const totalPointsIssued = customers.reduce((sum, c) => sum + c.loyaltyPoints, 0);
    const avgPointsPerCustomer = customers.length > 0 ? totalPointsIssued / customers.length : 0;

    // Get recent transactions
    const recentTransactions = await this.prisma.loyaltyTransaction.findMany({
      where: {
        customer: { tenantId },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const pointsEarned = recentTransactions
      .filter((t) => t.type === LoyaltyTransactionType.EARNED)
      .reduce((sum, t) => sum + t.points, 0);

    const pointsRedeemed = Math.abs(
      recentTransactions
        .filter((t) => t.type === LoyaltyTransactionType.REDEEMED)
        .reduce((sum, t) => sum + t.points, 0),
    );

    return {
      totalCustomersWithPoints: customers.length,
      totalPointsIssued,
      avgPointsPerCustomer: Math.round(avgPointsPerCustomer),
      pointsEarned,
      pointsRedeemed,
      redemptionRate: pointsEarned > 0 ? (pointsRedeemed / pointsEarned) * 100 : 0,
    };
  }

  // ========================================
  // CONFIGURATION
  // ========================================

  getLoyaltyConfig() {
    return LOYALTY_CONFIG;
  }
}
