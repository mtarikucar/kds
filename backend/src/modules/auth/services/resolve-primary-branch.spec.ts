import { resolvePrimaryBranchId } from "./resolve-primary-branch";

describe("resolvePrimaryBranchId", () => {
  function makePrisma(found: { id: string } | null) {
    const findFirst = jest.fn().mockResolvedValue(found);
    return { prisma: { branch: { findFirst } }, findFirst };
  }

  it("returns the existing primaryBranchId unchanged and never queries when it is non-null", async () => {
    const { prisma, findFirst } = makePrisma(null);
    const out = await resolvePrimaryBranchId(prisma, "tenant-1", "branch-existing");
    expect(out).toBe("branch-existing");
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the tenant's oldest active branch when primaryBranchId is null", async () => {
    const { prisma, findFirst } = makePrisma({ id: "branch-main" });
    const out = await resolvePrimaryBranchId(prisma, "tenant-1", null);
    expect(out).toBe("branch-main");
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", status: "active" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  });

  it("falls back when primaryBranchId is undefined (loose Prisma select shape)", async () => {
    const { prisma } = makePrisma({ id: "branch-main" });
    const out = await resolvePrimaryBranchId(prisma, "tenant-1", undefined);
    expect(out).toBe("branch-main");
  });

  it("returns null when the tenant has no active branch at all", async () => {
    const { prisma } = makePrisma(null);
    const out = await resolvePrimaryBranchId(prisma, "tenant-1", null);
    expect(out).toBeNull();
  });
});
