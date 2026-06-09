import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  ReferralDirectoryPort,
  ResolvedReferral,
} from "../../../core-contracts/referral/referral-directory.port";

/**
 * Marketing-owned implementation of {@link ReferralDirectoryPort}. Reads the
 * marketing-owned `marketing_users` table to resolve a referral code to its
 * marketer. Lives under marketing/acl/ (marketing code) but is bound to the
 * global DI token by ProvisioningModule so core callers inject it without a
 * NestJS module import.
 */
@Injectable()
export class ReferralDirectoryService implements ReferralDirectoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async resolveReferralCode(code: string): Promise<ResolvedReferral | null> {
    const trimmed = code?.trim();
    if (!trimmed) return null;

    // `referralCode` is @unique on MarketingUser, so the resolve is O(1).
    const marketer = await this.prisma.marketingUser.findUnique({
      where: { referralCode: trimmed },
      select: { id: true, referralCode: true, status: true },
    });
    if (!marketer || marketer.status !== "ACTIVE" || !marketer.referralCode) {
      return null;
    }
    return {
      marketingUserId: marketer.id,
      referralCode: marketer.referralCode,
    };
  }
}
