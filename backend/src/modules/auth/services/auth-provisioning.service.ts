import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { addDays } from "date-fns";
import * as Sentry from "@sentry/node";
import { PrismaService } from "../../../prisma/prisma.service";
import {
  HARD_RESTRICTED_ROLES,
  UserRole,
} from "../../../common/constants/roles.enum";
import { PaymentProvider } from "../../../common/constants/subscription.enum";
import {
  isSubdomainQuarantined,
  randomSubdomainSuffix,
} from "../../../common/helpers/subdomain.helper";
import {
  ResourceAlreadyExistsException,
  ResourceNotFoundException,
} from "../../../common/exceptions";

/**
 * Parameters for the shared user-creation step. Mirrors the closure the
 * original AuthService.register defined inline; lifted here so both the
 * new-tenant (scenario 1) and join (scenario 2) paths share one user
 * `data`/`select` shape and the same restricted-role allow-list rule.
 */
export interface CreateUserParams {
  email: string;
  hashedPassword: string;
  firstName: string;
  lastName: string;
  userRole: UserRole;
  userStatus: string;
  // Required at registration (PayTR checkout needs it); normalized to E.164
  // by RegisterDto's @NormalizePhone before it reaches here.
  phone: string;
}

/**
 * AuthProvisioningService — owns tenant + subscription + branch + user
 * creation. The tenant/subscription/branch/user writes accept a transaction
 * client (`tx`) so the caller controls the rollback boundary: register()'s
 * scenario 1 threads ITS OWN $transaction in so a user.create failure rolls
 * back the tenant (no orphan tenant / consumed subdomain). The P2002 ->
 * ResourceAlreadyExistsException mapping covering the whole tx (including
 * user.create) is preserved in the caller; the social path keeps its own
 * mapping here.
 *
 * Extracted verbatim from AuthService — the tenant/subscription/branch data
 * shapes, the trial bookkeeping, and the featureOverrides seed are
 * byte-for-byte identical.
 */
@Injectable()
export class AuthProvisioningService {
  constructor(private prisma: PrismaService) {}

  /**
   * Find a free subdomain for a new tenant. Falls back to appending a
   * cryptographically-strong 6-hex suffix when the preferred slug is taken
   * or quarantined. Uniqueness is ultimately enforced by the DB unique
   * index (P2002 is caught by the caller); this just picks a candidate.
   */
  async allocateSubdomain(base: string): Promise<string> {
    const baseClean = base || "restaurant";
    const preferred = baseClean;
    const preferredTaken =
      (await isSubdomainQuarantined(this.prisma, preferred)) ||
      (await this.prisma.tenant.findUnique({
        where: { subdomain: preferred },
      }));
    if (!preferredTaken) return preferred;
    // Up to 5 attempts with random suffix — extraordinarily unlikely to collide.
    for (let i = 0; i < 5; i += 1) {
      const candidate = `${baseClean}-${randomSubdomainSuffix()}`;
      const taken =
        (await isSubdomainQuarantined(this.prisma, candidate)) ||
        (await this.prisma.tenant.findUnique({
          where: { subdomain: candidate },
        }));
      if (!taken) return candidate;
    }
    throw new Error("Could not allocate a free subdomain");
  }

  /**
   * Load the dedicated onboarding TRIAL plan and assert it is seeded with a
   * positive trial length. Every new tenant starts on this plan (full-premium
   * 7-day trial) instead of the old "trial on the BUSINESS plan" coupling —
   * which made signup depend on BUSINESS.trialDays and caused silent
   * trial→FREE transitions. Throws (refusing to register) if the seed/migration
   * for the TRIAL plan is missing or misconfigured.
   */
  async loadTrialPlanOrThrow() {
    const trialPlan = await this.prisma.subscriptionPlan.findUnique({
      where: { name: "TRIAL" },
    });
    if (!trialPlan) {
      throw new ResourceNotFoundException("TRIAL subscription plan");
    }
    if (trialPlan.trialDays <= 0) {
      throw new ResourceNotFoundException(
        "TRIAL plan has no trialDays configured — re-seed/migrate plans",
      );
    }
    return trialPlan;
  }

  /**
   * Seed `featureOverrides` with the BUSINESS plan's flag set so
   * PlanFeatureGuard's fallback path resolves correctly during the first
   * ~30 seconds while the entitlement engine projector is still warming up.
   */
  buildPlanFeatureOverrides(businessPlan: {
    advancedReports?: boolean | null;
    multiLocation?: boolean | null;
    customBranding?: boolean | null;
    apiAccess?: boolean | null;
    prioritySupport?: boolean | null;
    inventoryTracking?: boolean | null;
    kdsIntegration?: boolean | null;
    reservationSystem?: boolean | null;
    personnelManagement?: boolean | null;
    deliveryIntegration?: boolean | null;
    posAccess?: boolean | null;
  }) {
    return {
      advancedReports: !!businessPlan.advancedReports,
      multiLocation: !!businessPlan.multiLocation,
      customBranding: !!businessPlan.customBranding,
      apiAccess: !!businessPlan.apiAccess,
      prioritySupport: !!businessPlan.prioritySupport,
      inventoryTracking: !!businessPlan.inventoryTracking,
      kdsIntegration: !!businessPlan.kdsIntegration,
      reservationSystem: !!businessPlan.reservationSystem,
      personnelManagement: !!businessPlan.personnelManagement,
      deliveryIntegration: !!businessPlan.deliveryIntegration,
      // posAccess was historically omitted here (the v3.0.7 bug), which
      // briefly hid POS on a fresh BUSINESS tenant during projector warm-up.
      posAccess: !!businessPlan.posAccess,
    };
  }

  /**
   * Shared user-creation step. Creates the user + (for restricted roles) the
   * matching userBranchAssignment allow-list row, all on the provided
   * transaction client. Runs INSIDE the caller's tx so a failure here rolls
   * back the whole provisioning. Restricted roles get an explicit allow-list
   * row equal to their primary branch.
   */
  async createUserWithAssignment(
    tx: Prisma.TransactionClient,
    txTenantId: string,
    txPrimaryBranchId: string,
    params: CreateUserParams,
  ) {
    const {
      email,
      hashedPassword,
      firstName,
      lastName,
      userRole,
      userStatus,
      phone,
    } = params;
    const created = await tx.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phone,
        role: userRole,
        tenantId: txTenantId,
        status: userStatus,
        primaryBranchId: txPrimaryBranchId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        tenantId: true,
        primaryBranchId: true,
      },
    });
    // Restricted roles get an explicit allow-list row equal to
    // their primary branch. BranchGuard short-circuits on
    // primaryBranchId for these roles, but the row gives admin UI
    // a uniform place to inspect "which branches does this user
    // see" without role-conditional branching.
    if ((HARD_RESTRICTED_ROLES as readonly string[]).includes(userRole)) {
      await tx.userBranchAssignment.create({
        data: {
          userId: created.id,
          branchId: txPrimaryBranchId,
          tenantId: txTenantId,
        },
      });
    }
    return created;
  }

  /**
   * Scenario 1 (new restaurant) provisioning, run INSIDE the caller's
   * transaction `tx`. Creates tenant + TRIALING BUSINESS subscription + Main
   * branch + the ADMIN user (via createUserWithAssignment) — all sharing the
   * caller's rollback boundary. The caller owns the $transaction and the
   * P2002 mapping so a user.create failure rolls back the tenant.
   */
  async provisionNewTenantWithAdmin(
    tx: Prisma.TransactionClient,
    args: {
      restaurantName: string;
      finalSubdomain: string;
      trialPlan: any;
      planFeatureOverrides: Record<string, boolean>;
      now: Date;
      trialEnd: Date;
      userParams: CreateUserParams;
    },
  ) {
    const {
      restaurantName,
      finalSubdomain,
      trialPlan,
      planFeatureOverrides,
      now,
      trialEnd,
      userParams,
    } = args;

    const created = await tx.tenant.create({
      data: {
        name: restaurantName,
        subdomain: finalSubdomain,
        currentPlanId: trialPlan.id,
        // Onboarding trial bookkeeping (the single trial; per-plan
        // usedTrialPlanIds is retired). trialEndsAt drives the lock countdown.
        trialUsed: true,
        trialStartedAt: now,
        trialEndsAt: trialEnd,
        featureOverrides: planFeatureOverrides,
      },
    });
    await tx.subscription.create({
      data: {
        tenantId: created.id,
        planId: trialPlan.id,
        status: "TRIALING",
        billingCycle: "MONTHLY",
        // PayTR is the only configured provider; this row is the
        // trial — no charge moves until the post-trial checkout.
        paymentProvider: PaymentProvider.PAYTR,
        startDate: now,
        currentPeriodStart: now,
        // During trial, currentPeriodEnd == trialEnd. At expiry expireTrials
        // flips the status to TRIAL_ENDED (locked) — the plan does NOT change
        // (no FREE landing); the tenant must activate a paid plan to continue.
        currentPeriodEnd: trialEnd,
        isTrialPeriod: true,
        trialStart: now,
        trialEnd,
        amount: trialPlan.monthlyPrice,
        currency: trialPlan.currency,
        cancelAtPeriodEnd: false,
      },
    });
    // v3.0.0 — every new tenant ships with a Main branch.
    // Bundled into the same tx as tenant + subscription so other
    // modules never observe a tenant without one. The DB CHECK
    // constraint on users requires WAITER/KITCHEN/COURIER to
    // carry a primaryBranchId, so the tenant being usable
    // depends on this row existing.
    const mainBranch = await tx.branch.create({
      data: {
        tenantId: created.id,
        name: "Main",
        status: "active",
        timezone: "UTC",
      },
      select: { id: true },
    });
    // Create the ADMIN user inside the SAME transaction as the
    // tenant + subscription + branch. If anything here (or the
    // user create itself) throws, the whole tx rolls back and no
    // orphan tenant / consumed subdomain is left behind.
    const createdUser = await this.createUserWithAssignment(
      tx,
      created.id,
      mainBranch.id,
      userParams,
    );
    return {
      tenant: created,
      mainBranchId: mainBranch.id,
      user: createdUser,
    };
  }

  /**
   * Create a new user from social auth (Google/Apple). Auto-creates a tenant
   * subscribed to the BUSINESS trial + a Main branch + the ADMIN user — in
   * one transaction so a failure midway does not leave orphaned rows. Returns
   * the created user row; the caller mints tokens.
   */
  async createSocialAuthUser(data: {
    email: string;
    firstName: string;
    lastName: string;
    googleId?: string;
    appleId?: string;
    authProvider: string;
  }) {
    const { email, firstName, lastName, googleId, appleId, authProvider } =
      data;

    // Generate restaurant name from email or name
    const restaurantName =
      firstName && firstName !== "User"
        ? `${firstName}'s Restaurant`
        : `Restaurant ${email.split("@")[0]}`;

    const baseSubdomain = restaurantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const subdomain = await this.allocateSubdomain(baseSubdomain);

    // Social signups get the SAME provisioning as email registration: the
    // 7-day onboarding TRIAL plan + an auto-created Main branch + seeded
    // featureOverrides. Keep this in lockstep with register()'s ADMIN scenario.
    const trialPlan = await this.loadTrialPlanOrThrow();

    const now = new Date();
    const trialEnd = addDays(now, trialPlan.trialDays);

    // Seed the plan's flag set so PlanFeatureGuard's fallback resolves while
    // the entitlement projector warms up — see register() for the full story.
    const planFeatureOverrides = this.buildPlanFeatureOverrides(trialPlan);

    // Tenant + subscription + Main branch + user in one transaction so a
    // failure midway does not leave orphaned rows.
    let user;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: restaurantName,
            subdomain,
            currentPlanId: trialPlan.id,
            trialUsed: true,
            trialStartedAt: now,
            trialEndsAt: trialEnd,
            featureOverrides: planFeatureOverrides,
          },
        });
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: trialPlan.id,
            status: "TRIALING",
            billingCycle: "MONTHLY",
            paymentProvider: PaymentProvider.PAYTR,
            startDate: now,
            currentPeriodStart: now,
            currentPeriodEnd: trialEnd,
            isTrialPeriod: true,
            trialStart: now,
            trialEnd,
            amount: trialPlan.monthlyPrice,
            currency: trialPlan.currency,
            cancelAtPeriodEnd: false,
          },
        });
        // Every new tenant ships with a Main branch (matches register()), so
        // the dashboard never prompts "create a branch" against the
        // MULTI_LOCATION gate.
        const mainBranch = await tx.branch.create({
          data: {
            tenantId: tenant.id,
            name: "Main",
            status: "active",
            timezone: "UTC",
          },
          select: { id: true },
        });
        return tx.user.create({
          data: {
            email,
            password: "",
            firstName,
            lastName,
            role: UserRole.ADMIN,
            tenantId: tenant.id,
            primaryBranchId: mainBranch.id,
            googleId,
            appleId,
            authProvider,
            emailVerified: true,
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            tenantId: true,
          },
        });
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ResourceAlreadyExistsException(
          "Tenant",
          "subdomain",
          subdomain,
        );
      }
      throw err;
    }

    // Track new social auth registration in Sentry — email + name omitted
    // (PII scrub policy). restaurantName is business metadata not PII.
    Sentry.captureMessage("New user registered via social auth", {
      level: "info",
      tags: {
        event: "user.register.social",
        provider: authProvider,
        role: user.role,
      },
      extra: {
        userId: user.id,
        tenantId: user.tenantId,
        restaurantName,
      },
    });

    return user;
  }
}
