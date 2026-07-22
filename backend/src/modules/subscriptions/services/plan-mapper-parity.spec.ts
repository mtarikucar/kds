import { Prisma } from "@prisma/client";
import { SubscriptionService } from "./subscription.service";
import { BillingService } from "./billing.service";
import { NotificationService } from "./notification.service";
import { PlanProjectorService } from "../../entitlements/plan-projector.service";
import { TenantProvisioningService } from "../../provisioning/tenant-provisioning.service";
import { AuthProvisioningService } from "../../auth/services/auth-provisioning.service";
import { DemoService } from "../../demo/demo.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";
import { ProvisionTenantForLeadCommand } from "../../../core-contracts/provisioning/tenant-provisioning.types";

jest.mock("bcryptjs", () => ({
  hash: jest.fn().mockResolvedValue("$hashed$"),
  hashSync: jest.fn().mockReturnValue("$hashed$"),
}));
jest.mock("../../../common/helpers/subdomain.helper", () => ({
  isSubdomainQuarantined: jest.fn().mockResolvedValue(false),
  randomSubdomainSuffix: jest.fn().mockReturnValue("abc123"),
}));

/**
 * Drift tripwire (audit finding: "yeni plan kolonu ~14 ayna, 2 el-mapper
 * tripwire YAKALAMAZ" — see plan-mapper drift class in the audit report).
 *
 * PlanProjectorService.FEATURE_COLUMNS / LIMIT_COLUMNS is the single
 * authoritative list of SubscriptionPlan columns (plan-projector.service.spec.ts
 * iter-24 pins THAT list against the Prisma schema). But several hand-written
 * mappers mirror the SAME plan record independently and are NOT covered by
 * that snapshot:
 *   - SubscriptionService.getAvailablePlans() — sales-page plan matrix
 *   - TenantProvisioningService.provisionTenantForLead() featureOverrides seed
 *   - AuthProvisioningService.buildPlanFeatureOverrides()
 *   - DemoService.ALL_FEATURES
 *
 * A column added to the schema + projector (the "canonical" pair the iter-24
 * test guards) can still silently drift out of these four mappers with no
 * test failing — exactly what happened to `posAccess`/`maxBranches` in
 * getAvailablePlans and `aiContentGeneration` in the three
 * provisioning/demo mirrors. This spec pins all four against the same
 * FEATURE_COLUMNS/LIMIT_COLUMNS source of truth so a future column addition
 * fails LOUDLY here instead of silently degrading the sales page / warm-up
 * fallback / demo tenant.
 *
 * Every mapper below is pinned by iterating the FULL FEATURE_COLUMNS (and,
 * for getAvailablePlans, LIMIT_COLUMNS) list rather than a single hardcoded
 * key — a single-key pin (e.g. "includes aiContentGeneration") only proves
 * THAT key survived; it stays green if a DIFFERENT future column drops out
 * of the same mapper. Each of the three provisioning/demo mirrors was
 * verified against its actual source to confirm it is meant to cover the
 * full set (not a deliberate subset) before being pinned this way — see the
 * per-`describe` comments below. DemoService's demo-plan LIMIT_COLUMNS
 * mirror (the maxX fields on its subscriptionPlan.upsert) is pinned in
 * demo.service.spec.ts instead, noted at the bottom of this file.
 */
describe("Plan-mapper drift tripwire", () => {
  // `as any` to reach the private static — same escape hatch used by
  // plan-projector.service.spec.ts's iter-24 snapshot test.
  const FEATURE_COLUMNS: readonly string[] = (PlanProjectorService as any)
    .FEATURE_COLUMNS;
  const LIMIT_COLUMNS: readonly string[] = (PlanProjectorService as any)
    .LIMIT_COLUMNS;

  it("sanity: FEATURE_COLUMNS/LIMIT_COLUMNS are non-empty (guards against a no-op tripwire)", () => {
    expect(FEATURE_COLUMNS.length).toBeGreaterThan(0);
    expect(LIMIT_COLUMNS.length).toBeGreaterThan(0);
  });

  describe("SubscriptionService.getAvailablePlans", () => {
    let prisma: MockPrismaClient;
    let svc: SubscriptionService;

    beforeEach(() => {
      prisma = mockPrismaClient();
      const billing = {} as jest.Mocked<BillingService>;
      const notifications = {} as jest.Mocked<NotificationService>;
      svc = new SubscriptionService(
        prisma as any,
        billing,
        notifications,
        { append: jest.fn().mockResolvedValue("outbox-id") } as any,
        {
          getForTenant: jest.fn().mockResolvedValue({
            features: {},
            limits: {},
            integrations: {},
            computedAt: new Date(0).toISOString(),
          }),
        } as any,
      );

      // Build a plan row that sets every FEATURE_COLUMNS entry to `true` and
      // every LIMIT_COLUMNS entry to a distinct positive number, so the test
      // both proves the KEY is surfaced and (for limits) that the VALUE is
      // sourced from the plan row rather than a hardcoded stand-in.
      const planRow: Record<string, unknown> = {
        id: "plan-1",
        name: "BUSINESS",
        displayName: "Business",
        description: "desc",
        monthlyPrice: new Prisma.Decimal(1000),
        yearlyPrice: new Prisma.Decimal(10000),
        currency: "TRY",
        trialDays: 14,
        discountPercentage: null,
        discountLabel: null,
        discountEndDate: null,
        isDiscountActive: false,
        isActive: true,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      };
      FEATURE_COLUMNS.forEach((col) => {
        planRow[col] = true;
      });
      LIMIT_COLUMNS.forEach((col, i) => {
        planRow[col] = (i + 1) * 10;
      });

      prisma.subscriptionPlan.findMany.mockResolvedValue([planRow as any]);
    });

    it("features block includes every FEATURE_COLUMNS key", async () => {
      const [plan] = await svc.getAvailablePlans();
      for (const col of FEATURE_COLUMNS) {
        expect(plan.features).toHaveProperty(col);
        expect((plan.features as any)[col]).toBe(true);
      }
    });

    it("limits block includes every LIMIT_COLUMNS key, sourced from the plan row", async () => {
      const [plan] = await svc.getAvailablePlans();
      LIMIT_COLUMNS.forEach((col, i) => {
        expect(plan.limits).toHaveProperty(col);
        expect((plan.limits as any)[col]).toBe((i + 1) * 10);
      });
    });
  });

  describe("TenantProvisioningService.provisionTenantForLead featureOverrides", () => {
    // VERIFIED against the mapper (tenant-provisioning.service.ts's
    // `featureOverrides: Object.fromEntries(Object.entries({...}))` literal
    // inside provisionTenantForLead): every one of the 13 FEATURE_COLUMNS is
    // listed there — this mirror is meant to cover the FULL set, not a
    // subset, so pinning against all of FEATURE_COLUMNS (superseding the old
    // single-key aiContentGeneration-only assertion) is correct here, not a
    // false-failing over-assertion.
    it("seeds every FEATURE_COLUMNS key when the plan grants it (full-set mirror)", async () => {
      const prisma = mockPrismaClient();
      const config = { get: jest.fn().mockReturnValue(undefined) };
      const svc = new TenantProvisioningService(prisma as any, config as any);

      (prisma.$transaction as any).mockImplementation(async (fn: any) =>
        fn(prisma),
      );
      prisma.tenantProvisioningLog.findUnique.mockResolvedValue(null as any);
      const planRow: Record<string, unknown> = {
        id: "plan-pro",
        name: "PRO",
        isActive: true,
        monthlyPrice: new Prisma.Decimal(1299),
        currency: "TRY",
        trialDays: 14,
        commissionRate: new Prisma.Decimal(0.15),
      };
      FEATURE_COLUMNS.forEach((col) => {
        planRow[col] = true;
      });
      prisma.subscriptionPlan.findUnique.mockResolvedValue(planRow as any);
      prisma.user.findUnique.mockResolvedValue(null as any);
      prisma.tenant.findUnique.mockResolvedValue(null as any);
      prisma.tenant.create.mockResolvedValue({
        id: "tenant-1",
        subdomain: "test-bistro",
      } as any);
      prisma.branch.create.mockResolvedValue({ id: "branch-main" } as any);
      prisma.user.create.mockResolvedValue({ id: "admin-1" } as any);
      prisma.subscription.create.mockResolvedValue({ id: "sub-1" } as any);
      prisma.tenantProvisioningLog.create.mockResolvedValue({} as any);

      const command: ProvisionTenantForLeadCommand = {
        leadId: "lead-1",
        idempotencyKey: "lead-convert:lead-1",
        tenantName: "Test Bistro",
        admin: {
          email: "owner@test.com",
          firstName: "Ada",
          lastName: "Lovelace",
        },
        plan: { planId: "plan-pro", amountOverride: null, trialDaysOverride: null },
      };
      await svc.provisionTenantForLead(command);

      const data = (prisma.tenant.create as any).mock.calls[0][0].data;
      for (const col of FEATURE_COLUMNS) {
        expect(data.featureOverrides).toHaveProperty(col, true);
      }
    });
  });

  describe("AuthProvisioningService.buildPlanFeatureOverrides", () => {
    // VERIFIED against the mapper (buildPlanFeatureOverrides's parameter
    // type + Object.fromEntries(Object.entries({...})) literal): every one
    // of the 13 FEATURE_COLUMNS is listed — full-set mirror, same as
    // TenantProvisioningService's featureOverrides seed above.
    it("includes every FEATURE_COLUMNS key when the plan grants it (full-set mirror)", () => {
      const prisma = { subscriptionPlan: { findUnique: jest.fn() } };
      const svc = new AuthProvisioningService(prisma as any);
      const businessPlan: Record<string, unknown> = {};
      FEATURE_COLUMNS.forEach((col) => {
        businessPlan[col] = true;
      });
      const overrides = svc.buildPlanFeatureOverrides(businessPlan as any);
      for (const col of FEATURE_COLUMNS) {
        expect(overrides).toHaveProperty(col, true);
      }
    });
  });

  describe("DemoService.ALL_FEATURES", () => {
    // VERIFIED against the mapper (demo.service.ts's ALL_FEATURES static
    // object): every one of the 13 FEATURE_COLUMNS is listed as `true` —
    // "every screen reachable in the demo" documents an intentional
    // full-set mirror, so pinning against all of FEATURE_COLUMNS is correct.
    it("grants every FEATURE_COLUMNS key (every screen reachable in the demo)", () => {
      const allFeatures = (DemoService as any).ALL_FEATURES;
      for (const col of FEATURE_COLUMNS) {
        expect(allFeatures).toHaveProperty(col, true);
      }
    });
  });

  // DemoService's demo-plan seed LIMIT_COLUMNS mirror (the maxX fields on
  // the subscriptionPlan.upsert create block inside DemoService.seed()) is
  // pinned in demo.service.spec.ts's cold-start seed test instead of here —
  // exercising ensureDemoTenant() needs the full tenant/branch/user/menu
  // mock harness that spec file already builds, so duplicating it here
  // would just be the same assertion behind a second copy of that harness.
  // See the "seeds the full demo on a cold start" test there, which now
  // iterates PlanProjectorService.LIMIT_COLUMNS the same way this file
  // iterates FEATURE_COLUMNS above. (Drift found + fixed there: `maxBranches`
  // was missing from that create block and fell through to the Prisma
  // schema default of 1 despite ALL_FEATURES.multiLocation being true —
  // see demo.service.ts for the fix.)
});
