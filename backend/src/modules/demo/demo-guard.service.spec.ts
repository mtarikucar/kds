import { ForbiddenException } from "@nestjs/common";
import { DemoGuardService } from "./demo-guard.service";
import { DEMO_PLAN_NAME } from "./demo.constants";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";

/**
 * Task D1 — demo-account payment block. DemoGuardService is the single
 * source of truth for recognizing the shared "explore demo" tenant: it
 * keys off tenant.currentPlan.name === DEMO_PLAN_NAME (the same constant
 * DemoService seeds the demo plan with), NOT any JWT claim — so it also
 * covers the @Public self-pay path, which carries no JWT at all.
 */
describe("DemoGuardService", () => {
  let prisma: MockPrismaClient;
  let guard: DemoGuardService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    guard = new DemoGuardService(prisma as any);
  });

  describe("isDemoTenant", () => {
    it("returns true when the tenant's current plan is the DEMO plan", async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        currentPlan: { name: DEMO_PLAN_NAME },
      });

      await expect(guard.isDemoTenant("tenant-demo")).resolves.toBe(true);
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: "tenant-demo" },
        select: { currentPlan: { select: { name: true } } },
      });
    });

    it("returns false for a real (non-DEMO) plan", async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        currentPlan: { name: "PRO" },
      });

      await expect(guard.isDemoTenant("tenant-real")).resolves.toBe(false);
    });

    it("fails open (returns false) when the tenant can't be resolved", async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(guard.isDemoTenant("missing-tenant")).resolves.toBe(false);
    });

    it("fails open when the tenant has no currentPlan attached", async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        currentPlan: null,
      });

      await expect(guard.isDemoTenant("tenant-no-plan")).resolves.toBe(false);
    });

    it("returns false for an empty tenantId without querying Prisma", async () => {
      await expect(guard.isDemoTenant("")).resolves.toBe(false);
      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("assertNotDemo", () => {
    it("throws ForbiddenException with errorCode DEMO_PAYMENT_BLOCKED for the demo tenant", async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        currentPlan: { name: DEMO_PLAN_NAME },
      });

      await expect(guard.assertNotDemo("tenant-demo")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        guard.assertNotDemo("tenant-demo"),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          statusCode: 403,
          errorCode: "DEMO_PAYMENT_BLOCKED",
          message: "Demo modunda ödeme alınamaz.",
        }),
      });
    });

    it("resolves without throwing for a non-DEMO plan", async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        currentPlan: { name: "BUSINESS" },
      });

      await expect(guard.assertNotDemo("tenant-real")).resolves.toBeUndefined();
    });

    it("resolves without throwing when the tenant is unresolvable (fail-open on unknown)", async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        guard.assertNotDemo("missing-tenant"),
      ).resolves.toBeUndefined();
    });
  });
});
