import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { numericEnv } from "../../common/config/numeric-env.util";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { LoyaltyService } from "./loyalty.service";
import { generateReferralSuffix } from "./customers.helpers";

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  // Loyalty payouts for a successful, phone-verified referral. Raising these
  // without also raising the daily-cap / verification gates will make this
  // endpoint economically attractive to farm.
  private readonly REFERRER_BONUS = 100;
  private readonly REFERRED_BONUS = 50;
  private readonly DAILY_TENANT_CAP = 200;

  // Collision-retry budget for unique referral-code generation. Default 10;
  // override via REFERRAL_CODE_MAX_ATTEMPTS.
  private readonly codeMaxAttempts: number;

  constructor(
    private prisma: PrismaService,
    private loyaltyService: LoyaltyService,
    private readonly config?: ConfigService,
  ) {
    this.codeMaxAttempts = numericEnv(
      this.config?.get("REFERRAL_CODE_MAX_ATTEMPTS"),
      10,
    );
  }

  async generateReferralCode(
    customerId: string,
    tenantId: string,
  ): Promise<string> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { name: true, referralCode: true },
    });
    if (!customer) throw new BadRequestException("Customer not found");
    if (customer.referralCode) return customer.referralCode;

    const maxAttempts = this.codeMaxAttempts;
    for (let i = 0; i < maxAttempts; i++) {
      const namePart = customer.name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .substring(0, 4)
        .padEnd(4, "X");
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
          !(
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          )
        ) {
          throw err;
        }
      }
    }
    throw new ConflictException("Failed to generate unique referral code");
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
      throw new BadRequestException("Invalid referral code");
    }

    // Per-tenant daily cap on referral grants to cap loyalty-point farming.
    // The cap check MUST run inside the same Serializable transaction as
    // the referral insert; doing it outside leaves a window where 200+
    // concurrent requests all see "below cap" and all succeed
    // (200 × bonus = ~30k farmable points per attack burst).
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60_000);

    return this.prisma.$transaction(
      async (tx) => {
        const todayCount = await tx.customerReferral.count({
          where: {
            referrer: { tenantId },
            createdAt: { gte: oneDayAgo },
          },
        });
        if (todayCount >= this.DAILY_TENANT_CAP) {
          throw new ForbiddenException("Daily referral limit reached");
        }

        const referrer = await tx.customer.findFirst({
          where: { referralCode: code, tenantId },
          select: { id: true, name: true },
        });
        if (!referrer) throw new BadRequestException("Invalid referral code");

        const referredCustomer = await tx.customer.findFirst({
          where: { id: referredCustomerId, tenantId },
          select: {
            id: true,
            referredBy: true,
            phoneVerified: true,
            totalOrders: true,
          },
        });
        if (!referredCustomer)
          throw new BadRequestException("Customer not found");

        if (!referredCustomer.phoneVerified) {
          throw new ForbiddenException(
            "Phone must be verified before applying a referral code",
          );
        }
        if (referredCustomer.referredBy) {
          throw new BadRequestException(
            "Customer has already used a referral code",
          );
        }
        if (referrer.id === referredCustomerId) {
          throw new BadRequestException(
            "You cannot use your own referral code",
          );
        }

        const referral = await tx.customerReferral.create({
          data: {
            referrerId: referrer.id,
            referredId: referredCustomerId,
            referralCode: code,
            status: "COMPLETED",
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
          throw new ConflictException("Referral already applied");
        }

        // Inline loyalty mutations to keep the whole flow atomic. These use
        // the same pattern as LoyaltyService.awardPoints but against the tx
        // client.
        const awardInTx = async (
          customerId: string,
          points: number,
          description: string,
        ) => {
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
              tenantId,
              customerId,
              type: "REFERRAL",
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getReferralStats(customerId: string, tenantId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { referralCode: true },
    });
    if (!customer) throw new BadRequestException("Customer not found");

    // Iter-80: count + page-cap on the listing. totalReferrals is the
    // canonical "how many" — it stays accurate via a separate count()
    // even if the customer has more than the per-page cap. The list of
    // rows the public profile renders is bounded so a super-engaged
    // influencer customer with thousands of referrals doesn't pull
    // every row through the QR-menu page in one response (each row
    // carries the referred customer's name; over time that's a
    // measurable payload).
    const STATS_PAGE_HARD_CAP = 200;
    const [referrals, totalReferrals, aggregate] =
      await this.prisma.$transaction([
        this.prisma.customerReferral.findMany({
          where: { referrerId: customerId, referrer: { tenantId } },
          include: { referred: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: STATS_PAGE_HARD_CAP,
        }),
        this.prisma.customerReferral.count({
          where: { referrerId: customerId, referrer: { tenantId } },
        }),
        // Sum across ALL rewarded referrals (not just the visible page)
        // so totalPointsEarned stays canonical regardless of the page cap.
        this.prisma.customerReferral.aggregate({
          where: {
            referrerId: customerId,
            referrer: { tenantId },
            rewardedAt: { not: null },
          },
          _sum: { referrerReward: true },
        }),
      ]);

    return {
      referralCode: customer.referralCode || "",
      totalReferrals,
      totalPointsEarned: aggregate._sum.referrerReward ?? 0,
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

  // NOTE: a `getTenantReferrals(tenantId)` helper used to live here.
  // It had no callers (no controller, no scheduler, no service) and
  // would have returned an unbounded findMany including referrer +
  // referred phone numbers (PII). Removed in iter-80 so a future
  // change adding an admin route can't quietly resurrect the
  // unbounded listing — a fresh implementation will be forced to add
  // pagination + maskPhone + role-gating from scratch.
}
