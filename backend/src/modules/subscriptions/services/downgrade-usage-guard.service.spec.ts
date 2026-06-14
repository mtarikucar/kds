import { BadRequestException } from "@nestjs/common";
import { DowngradeUsageGuardService } from "./downgrade-usage-guard.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Unit tests for the downgrade usage-limit guard extracted verbatim from
 * SubscriptionService. Pins the exact behavior the parent service relied on:
 *   - ACTIVE-only user count predicate
 *   - per-dimension cap comparison with the precise violation message format
 *   - `-1` means unlimited (never a violation)
 *   - happy path resolves without throwing
 */
describe("DowngradeUsageGuardService", () => {
  let prisma: MockPrismaClient;
  let svc: DowngradeUsageGuardService;

  const TENANT_ID = "tenant-1";

  const generousPlan = {
    maxUsers: 10,
    maxTables: 10,
    maxProducts: 100,
    maxCategories: 20,
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new DowngradeUsageGuardService(prisma as any);
    // Defaults: comfortably under every cap.
    prisma.user.count.mockResolvedValue(2 as any);
    prisma.table.count.mockResolvedValue(3 as any);
    prisma.product.count.mockResolvedValue(4 as any);
    prisma.category.count.mockResolvedValue(5 as any);
  });

  it("counts ACTIVE users only", async () => {
    await svc.assertDowngradeAllowed(TENANT_ID, generousPlan);
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, status: "ACTIVE" },
    });
  });

  it("scopes table/product/category counts to the tenant", async () => {
    await svc.assertDowngradeAllowed(TENANT_ID, generousPlan);
    expect(prisma.table.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
    });
    expect(prisma.product.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
    });
    expect(prisma.category.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
    });
  });

  it("resolves silently when usage is under all caps", async () => {
    await expect(
      svc.assertDowngradeAllowed(TENANT_ID, generousPlan),
    ).resolves.toBeUndefined();
  });

  it("throws a 400 listing every violated dimension in order", async () => {
    prisma.user.count.mockResolvedValue(11 as any);
    prisma.table.count.mockResolvedValue(11 as any);
    prisma.product.count.mockResolvedValue(101 as any);
    prisma.category.count.mockResolvedValue(21 as any);
    await expect(
      svc.assertDowngradeAllowed(TENANT_ID, generousPlan),
    ).rejects.toThrow(
      "Cannot downgrade: current usage exceeds new plan limits. Please reduce: " +
        "Users: 11/10, Tables: 11/10, Products: 101/100, Categories: 21/20",
    );
  });

  it("only lists the dimensions that actually exceed their cap", async () => {
    prisma.user.count.mockResolvedValue(11 as any); // over
    prisma.table.count.mockResolvedValue(3 as any); // under
    prisma.product.count.mockResolvedValue(4 as any); // under
    prisma.category.count.mockResolvedValue(21 as any); // over
    await expect(
      svc.assertDowngradeAllowed(TENANT_ID, generousPlan),
    ).rejects.toThrow("Please reduce: Users: 11/10, Categories: 21/20");
  });

  it("treats -1 as unlimited (no violation regardless of usage)", async () => {
    prisma.user.count.mockResolvedValue(9999 as any);
    prisma.table.count.mockResolvedValue(9999 as any);
    prisma.product.count.mockResolvedValue(9999 as any);
    prisma.category.count.mockResolvedValue(9999 as any);
    await expect(
      svc.assertDowngradeAllowed(TENANT_ID, {
        maxUsers: -1,
        maxTables: -1,
        maxProducts: -1,
        maxCategories: -1,
      }),
    ).resolves.toBeUndefined();
  });

  it("does NOT throw when usage exactly equals the cap (boundary)", async () => {
    prisma.user.count.mockResolvedValue(10 as any);
    prisma.table.count.mockResolvedValue(10 as any);
    prisma.product.count.mockResolvedValue(100 as any);
    prisma.category.count.mockResolvedValue(20 as any);
    await expect(
      svc.assertDowngradeAllowed(TENANT_ID, generousPlan),
    ).resolves.toBeUndefined();
  });

  it("rejects with a BadRequestException instance", async () => {
    prisma.user.count.mockResolvedValue(11 as any);
    await expect(
      svc.assertDowngradeAllowed(TENANT_ID, generousPlan),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
