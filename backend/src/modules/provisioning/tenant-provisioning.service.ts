import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { addDays, addMonths, addYears } from "date-fns";
import * as bcrypt from "bcryptjs";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../prisma/prisma.service";
import {
  isSubdomainQuarantined,
  randomSubdomainSuffix,
} from "../../common/helpers/subdomain.helper";
import { CoreProvisioningPort } from "../../core-contracts/provisioning/tenant-provisioning.port";
import {
  ProvisionTenantForLeadCommand,
  ProvisionTenantForLeadResult,
  ProvisionedPlanFacts,
  ProvisionedLeadRecord,
  PlanSnapshot,
  CoreProvisioningEmailInUseError,
  CoreProvisioningPlanInvalidError,
  CoreProvisioningSubdomainError,
} from "../../core-contracts/provisioning/tenant-provisioning.types";

type PlanRow = NonNullable<
  Awaited<ReturnType<PrismaService["subscriptionPlan"]["findUnique"]>>
>;
type LedgerRow = NonNullable<
  Awaited<ReturnType<PrismaService["tenantProvisioningLog"]["findUnique"]>>
>;

/**
 * Fallback signup-commission rate when a plan converts without a readable
 * `commissionRate` (cold seed without the column). Mirrors the historical
 * default that previously lived in MarketingLeadsService.
 */
const DEFAULT_SIGNUP_COMMISSION_RATE = 0.1;

/**
 * CORE-owned implementation of {@link CoreProvisioningPort}. Owns every write
 * to tenant / user / subscription that used to live inside
 * `MarketingLeadsService.convert`. Idempotent on the lead via the
 * `tenant_provisioning_log` ledger so a retried conversion never mints a
 * second tenant.
 */
@Injectable()
export class TenantProvisioningService implements CoreProvisioningPort {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async provisionTenantForLead(
    command: ProvisionTenantForLeadCommand,
  ): Promise<ProvisionTenantForLeadResult> {
    // Idempotent fast-path: a prior provision for this lead returns the same
    // tenant without writing anything.
    const prior = await this.prisma.tenantProvisioningLog.findUnique({
      where: { leadId: command.leadId },
    });
    if (prior) return this.replayResult(prior);

    // CORE owns SubscriptionPlan — validate + read the facts we need.
    let planRow: PlanRow | null = null;
    if (command.plan) {
      planRow = await this.prisma.subscriptionPlan.findUnique({
        where: { id: command.plan.planId },
      });
      if (!planRow || !planRow.isActive) {
        throw new CoreProvisioningPlanInvalidError(command.plan.planId);
      }
    }

    // Pre-flight email-collision check → typed port error instead of a raw P2002.
    const emailCollision = await this.prisma.user.findUnique({
      where: { email: command.admin.email },
      select: { id: true },
    });
    if (emailCollision) {
      throw new CoreProvisioningEmailInUseError(command.admin.email);
    }

    const now = new Date();
    const trialDays = planRow
      ? (command.plan!.trialDaysOverride ?? planRow.trialDays ?? 0)
      : 0;
    const canTrial = !!planRow && trialDays > 0 && planRow.name !== "FREE";
    const trialStart = canTrial ? now : null;
    const trialEnd = canTrial ? addDays(now, trialDays) : null;
    const currentPeriodEnd = canTrial
      ? (trialEnd as Date)
      : planRow
        ? addMonths(now, 1)
        : addYears(now, 10);
    const subscriptionAmount: Prisma.Decimal | number | null = planRow
      ? (command.plan!.amountOverride ?? planRow.monthlyPrice)
      : null;

    const baseSubdomain = command.tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const subdomain = await this.allocateSubdomain(baseSubdomain);

    // Random admin password the rep never sees — delivered to the new owner by
    // marketing's welcome email and rotated on first login.
    const rawPassword = randomBytes(12).toString("base64url");
    const hashedPassword = await bcrypt.hash(rawPassword, this.bcryptCost());

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: command.tenantName,
            subdomain,
            ...(planRow ? { currentPlanId: planRow.id } : {}),
            ...(canTrial && planRow
              ? {
                  trialUsed: true,
                  trialStartedAt: trialStart,
                  trialEndsAt: trialEnd,
                  usedTrialPlanIds: [planRow.id],
                }
              : {}),
          },
        });

        const adminUser = await tx.user.create({
          data: {
            email: command.admin.email,
            password: hashedPassword,
            firstName: command.admin.firstName,
            lastName: command.admin.lastName,
            role: "ADMIN",
            status: "ACTIVE",
            emailVerified: true,
            tenantId: tenant.id,
          },
        });

        let subscriptionId: string | null = null;
        if (planRow && subscriptionAmount != null) {
          const sub = await tx.subscription.create({
            data: {
              tenantId: tenant.id,
              planId: planRow.id,
              status: canTrial ? "TRIALING" : "ACTIVE",
              billingCycle: "MONTHLY",
              paymentProvider: "PAYTR",
              startDate: now,
              currentPeriodStart: now,
              currentPeriodEnd,
              isTrialPeriod: canTrial,
              trialStart,
              trialEnd,
              amount: subscriptionAmount,
              currency: planRow.currency,
              cancelAtPeriodEnd: false,
            },
          });
          subscriptionId = sub.id;
        }

        // Ledger: durable idempotency + reconciliation anchor. Unique on leadId
        // AND idempotencyKey, so a racing double-provision throws P2002 and the
        // catch below converges on the winner's tenant.
        await tx.tenantProvisioningLog.create({
          data: {
            leadId: command.leadId,
            idempotencyKey: command.idempotencyKey,
            tenantId: tenant.id,
            adminUserId: adminUser.id,
            subscriptionId,
          },
        });

        return {
          tenantId: tenant.id,
          adminUserId: adminUser.id,
          subscriptionId,
        };
      });

      return {
        tenantId: created.tenantId,
        adminUserId: created.adminUserId,
        subscriptionId: created.subscriptionId,
        subdomain,
        adminTempPassword: rawPassword,
        planFacts: this.planFacts(planRow),
        created: true,
      };
    } catch (err) {
      // A concurrent provision for the same lead won the ledger's unique
      // constraint (or the subdomain / admin-email unique index). Re-read the
      // ledger and return the winner's tenant — idempotent, no second tenant.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const winner = await this.prisma.tenantProvisioningLog.findUnique({
          where: { leadId: command.leadId },
        });
        if (winner) return this.replayResult(winner);
      }
      throw err;
    }
  }

  private planFacts(planRow: PlanRow | null): ProvisionedPlanFacts | null {
    if (!planRow) return null;
    return {
      monthlyPrice: Number(planRow.monthlyPrice),
      commissionRate:
        planRow.commissionRate != null
          ? Number(planRow.commissionRate)
          : DEFAULT_SIGNUP_COMMISSION_RATE,
      planCode: planRow.name,
    };
  }

  /**
   * Rebuild the result for an already-provisioned lead. The temp password is
   * intentionally empty (it was delivered on the first call); marketing only
   * sends the welcome email when `created === true`.
   */
  private async replayResult(
    log: LedgerRow,
  ): Promise<ProvisionTenantForLeadResult> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: log.tenantId },
      select: { subdomain: true },
    });
    const planFacts = await this.planFactsForSubscription(log.subscriptionId);

    return {
      tenantId: log.tenantId,
      adminUserId: log.adminUserId,
      subscriptionId: log.subscriptionId,
      subdomain: tenant?.subdomain ?? "",
      adminTempPassword: "",
      planFacts,
      created: false,
    };
  }

  async listProvisionedLeads(
    createdAfter: Date,
    createdBefore: Date,
  ): Promise<ProvisionedLeadRecord[]> {
    const logs = await this.prisma.tenantProvisioningLog.findMany({
      where: { createdAt: { gte: createdAfter, lte: createdBefore } },
      select: { leadId: true, tenantId: true, subscriptionId: true },
    });
    const records: ProvisionedLeadRecord[] = [];
    for (const log of logs) {
      records.push({
        leadId: log.leadId,
        tenantId: log.tenantId,
        planFacts: await this.planFactsForSubscription(log.subscriptionId),
      });
    }
    return records;
  }

  async describePlan(planId: string): Promise<PlanSnapshot | null> {
    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: planId },
      select: {
        name: true,
        displayName: true,
        monthlyPrice: true,
        currency: true,
      },
    });
    if (!plan) return null;
    return {
      planCode: plan.name,
      planName: plan.displayName,
      monthlyPrice: Number(plan.monthlyPrice),
      currency: plan.currency,
    };
  }

  /** Plan facts (commission basis) for a provisioned subscription, or null. */
  private async planFactsForSubscription(
    subscriptionId: string | null,
  ): Promise<ProvisionedPlanFacts | null> {
    if (!subscriptionId) return null;
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        plan: {
          select: { monthlyPrice: true, commissionRate: true, name: true },
        },
      },
    });
    if (!sub?.plan) return null;
    return {
      monthlyPrice: Number(sub.plan.monthlyPrice),
      commissionRate:
        sub.plan.commissionRate != null
          ? Number(sub.plan.commissionRate)
          : DEFAULT_SIGNUP_COMMISSION_RATE,
      planCode: sub.plan.name,
    };
  }

  /**
   * Pick a free subdomain for the converted tenant. Moved verbatim from
   * MarketingLeadsService.allocateSubdomain — it reads the core `tenants`
   * table, so it must live on the core side of the boundary.
   */
  private async allocateSubdomain(base: string): Promise<string> {
    const baseClean = base || "restaurant";
    const preferredTaken =
      (await isSubdomainQuarantined(this.prisma, baseClean)) ||
      (await this.prisma.tenant.findUnique({
        where: { subdomain: baseClean },
      }));
    if (!preferredTaken) return baseClean;
    for (let i = 0; i < 5; i += 1) {
      const candidate = `${baseClean}-${randomSubdomainSuffix()}`;
      const taken =
        (await isSubdomainQuarantined(this.prisma, candidate)) ||
        (await this.prisma.tenant.findUnique({
          where: { subdomain: candidate },
        }));
      if (!taken) return candidate;
    }
    throw new CoreProvisioningSubdomainError();
  }

  private bcryptCost(): number {
    const raw = this.config.get<string>("BCRYPT_COST");
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 10 && parsed <= 15
      ? parsed
      : 12;
  }
}
