import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LoyaltyService } from './loyalty.service';

@Injectable()
export class ReferralService {
  // Referral rewards configuration
  private readonly REFERRER_BONUS = 100; // Points for referrer when someone uses their code
  private readonly REFERRED_BONUS = 50;  // Points for new customer using a referral code

  constructor(
    private prisma: PrismaService,
    private loyaltyService: LoyaltyService,
  ) {}

  /**
   * Generate a unique referral code for a customer
   * Format: First 4 letters of name + 4 random alphanumeric characters
   * Example: JOHN2A4F, MARY9X7K
   */
  async generateReferralCode(customerId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true, referralCode: true },
    });

    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

    // If customer already has a referral code, return it
    if (customer.referralCode) {
      return customer.referralCode;
    }

    // Generate unique code
    let code: string;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      // Take first 4 letters of name (uppercase, alphanumeric only)
      const namePart = customer.name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .substring(0, 4)
        .padEnd(4, 'X');

      // Generate 4 random alphanumeric characters
      const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();

      code = `${namePart}${randomPart}`;

      // Check if code already exists
      const existing = await this.prisma.customer.findUnique({
        where: { referralCode: code },
      });

      if (!existing) {
        break;
      }

      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new ConflictException('Failed to generate unique referral code');
    }

    // Update customer with referral code
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { referralCode: code },
    });

    return code!;
  }

  /**
   * Apply a referral code when a new customer signs up
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
    // Find the customer who owns the referral code
    const referrer = await this.prisma.customer.findUnique({
      where: {
        referralCode,
        tenantId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!referrer) {
      throw new BadRequestException('Invalid referral code');
    }

    // Check if referred customer exists
    const referredCustomer = await this.prisma.customer.findUnique({
      where: { id: referredCustomerId },
      select: { id: true, referredBy: true, tenantId: true },
    });

    if (!referredCustomer) {
      throw new BadRequestException('Customer not found');
    }

    if (referredCustomer.tenantId !== tenantId) {
      throw new BadRequestException('Customer belongs to different tenant');
    }

    // Check if customer already used a referral code
    if (referredCustomer.referredBy) {
      throw new BadRequestException('Customer has already used a referral code');
    }

    // Prevent self-referral
    if (referrer.id === referredCustomerId) {
      throw new BadRequestException('You cannot use your own referral code');
    }

    // Create referral record
    const referral = await this.prisma.customerReferral.create({
      data: {
        referrerId: referrer.id,
        referredId: referredCustomerId,
        referralCode,
        status: 'COMPLETED', // Mark as completed immediately
        referrerReward: this.REFERRER_BONUS,
        referredReward: this.REFERRED_BONUS,
        completedAt: new Date(),
      },
    });

    // Update referred customer
    await this.prisma.customer.update({
      where: { id: referredCustomerId },
      data: { referredBy: referralCode },
    });

    // Award bonuses immediately
    await this.awardReferralBonuses(referral.id);

    return {
      success: true,
      referrer: {
        id: referrer.id,
        name: referrer.name,
      },
      bonusAwarded: true,
    };
  }

  /**
   * Award referral bonuses to both referrer and referred customer
   */
  async awardReferralBonuses(referralId: string): Promise<void> {
    const referral = await this.prisma.customerReferral.findUnique({
      where: { id: referralId },
      include: {
        referrer: true,
        referred: true,
      },
    });

    if (!referral) {
      throw new BadRequestException('Referral not found');
    }

    if (referral.rewardedAt) {
      console.log(`[Referral] Bonuses already awarded for referral ${referralId}`);
      return;
    }

    if (referral.status !== 'COMPLETED') {
      throw new BadRequestException('Referral not completed yet');
    }

    // Award bonus to referrer
    if (referral.referrerReward > 0) {
      await this.loyaltyService.addPoints({
        customerId: referral.referrerId,
        points: referral.referrerReward,
        type: 'REFERRAL',
        description: `Referral bonus for ${referral.referred.name}`,
        source: 'REFERRAL',
        metadata: {
          referralId: referral.id,
          referredCustomerId: referral.referredId,
          referredCustomerName: referral.referred.name,
        },
      });
    }

    // Award bonus to referred customer
    if (referral.referredReward > 0) {
      await this.loyaltyService.addPoints({
        customerId: referral.referredId,
        points: referral.referredReward,
        type: 'REFERRAL',
        description: `Welcome bonus for using referral code ${referral.referralCode}`,
        source: 'REFERRAL',
        metadata: {
          referralId: referral.id,
          referrerCustomerId: referral.referrerId,
          referrerCustomerName: referral.referrer.name,
        },
      });
    }

    // Mark as rewarded
    await this.prisma.customerReferral.update({
      where: { id: referralId },
      data: { rewardedAt: new Date() },
    });

    console.log(
      `[Referral] Awarded bonuses: ${referral.referrerReward} to referrer, ${referral.referredReward} to referred`
    );
  }

  /**
   * Get referral statistics for a customer
   */
  async getReferralStats(customerId: string): Promise<{
    referralCode: string;
    totalReferrals: number;
    totalPointsEarned: number;
    referrals: Array<{
      id: string;
      customerName: string;
      status: string;
      pointsEarned: number;
      createdAt: Date;
      completedAt: Date | null;
    }>;
  }> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { referralCode: true },
    });

    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

    const referrals = await this.prisma.customerReferral.findMany({
      where: { referrerId: customerId },
      include: {
        referred: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalPointsEarned = referrals
      .filter(r => r.rewardedAt)
      .reduce((sum, r) => sum + r.referrerReward, 0);

    return {
      referralCode: customer.referralCode || '',
      totalReferrals: referrals.length,
      totalPointsEarned,
      referrals: referrals.map(r => ({
        id: r.id,
        customerName: r.referred.name,
        status: r.status,
        pointsEarned: r.referrerReward,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      })),
    };
  }

  /**
   * Get all referrals for a tenant
   */
  async getTenantReferrals(tenantId: string): Promise<any[]> {
    return this.prisma.customerReferral.findMany({
      where: {
        referrer: { tenantId },
      },
      include: {
        referrer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        referred: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
