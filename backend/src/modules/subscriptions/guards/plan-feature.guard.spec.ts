import { ForbiddenException, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PlanFeatureGuard } from "./plan-feature.guard";
import { PrismaService } from "../../../prisma/prisma.service";
import { EntitlementService } from "../../entitlements/entitlement.service";
import {
  SubscriptionPlanType,
  PlanFeature,
} from "../../../common/constants/subscription.enum";

/**
 * Long-tail spec for PlanFeatureGuard. We exercise the early-exit decision
 * branches (no DB) and the plan-tier check. The deep limit-counting paths
 * are covered indirectly; here we pin: @Public → allow; missing tenant →
 * Forbidden; no requirements → allow without a DB read; required plan not
 * held → Forbidden; required plan held + active sub → allow.
 */
describe("PlanFeatureGuard", () => {
  function makeReflector(meta: Record<string, unknown>): Reflector {
    return {
      getAllAndOverride: jest.fn((key: string) => meta[key]),
    } as unknown as Reflector;
  }

  function ctxFor(user: unknown): ExecutionContext {
    return {
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  const entitlements = {
    getForTenant: jest.fn().mockResolvedValue({
      features: {},
      limits: {},
      integrations: {},
    }),
  } as unknown as EntitlementService;

  it("allows a @Public route without reading the DB", async () => {
    const prisma = { tenant: { findUnique: jest.fn() } } as unknown as PrismaService;
    const guard = new PlanFeatureGuard(
      makeReflector({ isPublic: true }),
      prisma,
      entitlements,
    );
    await expect(guard.canActivate(ctxFor({ tenantId: "t1" }))).resolves.toBe(
      true,
    );
    expect((prisma.tenant as any).findUnique).not.toHaveBeenCalled();
  });

  it("forbids when there is no authenticated tenant", async () => {
    const prisma = {} as unknown as PrismaService;
    const guard = new PlanFeatureGuard(makeReflector({}), prisma, entitlements);
    await expect(guard.canActivate(ctxFor(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("allows when the route declares no plan/feature/limit requirements", async () => {
    const prisma = { tenant: { findUnique: jest.fn() } } as unknown as PrismaService;
    const guard = new PlanFeatureGuard(makeReflector({}), prisma, entitlements);
    await expect(guard.canActivate(ctxFor({ tenantId: "t1" }))).resolves.toBe(
      true,
    );
    expect((prisma.tenant as any).findUnique).not.toHaveBeenCalled();
  });

  it("forbids when the tenant's plan is not in the required-plans list", async () => {
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          currentPlan: { name: "BASIC", displayName: "Basic" },
          featureOverrides: null,
          limitOverrides: null,
        }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ status: "ACTIVE" }),
      },
    } as unknown as PrismaService;
    const guard = new PlanFeatureGuard(
      makeReflector({ requiredPlans: [SubscriptionPlanType.BUSINESS] }),
      prisma,
      entitlements,
    );
    await expect(
      guard.canActivate(ctxFor({ tenantId: "t1" })),
    ).rejects.toThrow(/requires one of the following plans/i);
  });

  it("allows when the tenant holds a required plan and has a live subscription", async () => {
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          currentPlan: { name: "BUSINESS", displayName: "Business" },
          featureOverrides: null,
          limitOverrides: null,
        }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ status: "ACTIVE" }),
      },
    } as unknown as PrismaService;
    const guard = new PlanFeatureGuard(
      makeReflector({ requiredPlans: [SubscriptionPlanType.BUSINESS] }),
      prisma,
      entitlements,
    );
    await expect(guard.canActivate(ctxFor({ tenantId: "t1" }))).resolves.toBe(
      true,
    );
  });

  it("forbids a feature when the engine-resolved set does not grant it", async () => {
    const prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          currentPlan: { name: "PRO", displayName: "Pro", advancedReports: false },
          featureOverrides: null,
          limitOverrides: null,
        }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ status: "ACTIVE" }),
      },
    } as unknown as PrismaService;
    const ent = {
      getForTenant: jest.fn().mockResolvedValue({
        features: { "feature.someOther": true }, // populated but not the one needed
        limits: {},
        integrations: {},
      }),
    } as unknown as EntitlementService;
    const guard = new PlanFeatureGuard(
      makeReflector({ requiredFeatures: [PlanFeature.ADVANCED_REPORTS] }),
      prisma,
      ent,
    );
    await expect(
      guard.canActivate(ctxFor({ tenantId: "t1" })),
    ).rejects.toThrow(/not available in your current plan/i);
  });
});
