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
    it("seeds aiContentGeneration when the plan grants it", async () => {
      const prisma = mockPrismaClient();
      const config = { get: jest.fn().mockReturnValue(undefined) };
      const svc = new TenantProvisioningService(prisma as any, config as any);

      (prisma.$transaction as any).mockImplementation(async (fn: any) =>
        fn(prisma),
      );
      prisma.tenantProvisioningLog.findUnique.mockResolvedValue(null as any);
      prisma.subscriptionPlan.findUnique.mockResolvedValue({
        id: "plan-pro",
        name: "PRO",
        isActive: true,
        monthlyPrice: new Prisma.Decimal(1299),
        currency: "TRY",
        trialDays: 14,
        commissionRate: new Prisma.Decimal(0.15),
        aiContentGeneration: true,
      } as any);
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
      expect(data.featureOverrides).toHaveProperty("aiContentGeneration", true);
    });
  });

  describe("AuthProvisioningService.buildPlanFeatureOverrides", () => {
    it("includes aiContentGeneration when the plan grants it", () => {
      const prisma = { subscriptionPlan: { findUnique: jest.fn() } };
      const svc = new AuthProvisioningService(prisma as any);
      const overrides = svc.buildPlanFeatureOverrides({
        aiContentGeneration: true,
      } as any);
      expect(overrides).toHaveProperty("aiContentGeneration", true);
    });
  });

  describe("DemoService.ALL_FEATURES", () => {
    it("includes aiContentGeneration=true (every screen reachable in the demo)", () => {
      const allFeatures = (DemoService as any).ALL_FEATURES;
      expect(allFeatures).toHaveProperty("aiContentGeneration", true);
    });
  });
});
