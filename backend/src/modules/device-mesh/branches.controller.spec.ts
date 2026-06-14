import { BranchesController } from "./branches.controller";
import { BranchesService } from "./branches.service";
import { PrismaService } from "../../prisma/prisma.service";
import { UserRole } from "../../common/constants/roles.enum";

/**
 * Long-tail spec for BranchesController. The interesting logic is the
 * role-filtered `visible` endpoint (BranchPicker source): a hard-restricted
 * role sees ONLY its primaryBranchId; MANAGER sees its allow-list; ADMIN
 * sees every active branch. CRUD endpoints just thread the tenantId.
 */
describe("BranchesController", () => {
  let branches: Record<string, jest.Mock>;
  let prisma: { branch: { findFirst: jest.Mock; findMany: jest.Mock } };
  let ctrl: BranchesController;

  beforeEach(() => {
    branches = {
      list: jest.fn().mockResolvedValue([]),
      findOrThrow: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      archive: jest.fn().mockResolvedValue({}),
    };
    prisma = {
      branch: {
        findFirst: jest.fn().mockResolvedValue({ id: "b-primary" }),
        findMany: jest.fn().mockResolvedValue([{ id: "b1" }, { id: "b2" }]),
      },
    };
    ctrl = new BranchesController(
      branches as unknown as BranchesService,
      prisma as unknown as PrismaService,
    );
  });

  describe("visible (role-filtered)", () => {
    it("returns only the primary branch for a hard-restricted WAITER", async () => {
      const req = {
        user: {
          role: UserRole.WAITER,
          tenantId: "t1",
          primaryBranchId: "b-primary",
        },
      };
      const out = await ctrl.visible(req);
      expect(prisma.branch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "b-primary", tenantId: "t1" }),
        }),
      );
      expect(out).toEqual([{ id: "b-primary" }]);
    });

    it("returns [] for a restricted role with no primary branch", async () => {
      const req = {
        user: { role: UserRole.KITCHEN, tenantId: "t1" },
      };
      await expect(ctrl.visible(req)).resolves.toEqual([]);
      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    });

    it("returns the allow-list for a MANAGER", async () => {
      const req = {
        user: {
          role: UserRole.MANAGER,
          tenantId: "t1",
          allowedBranchIds: ["b1", "b2"],
        },
      };
      await ctrl.visible(req);
      expect(prisma.branch.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ["b1", "b2"] } }),
        }),
      );
    });

    it("returns every active branch for an ADMIN (wildcard)", async () => {
      const req = { user: { role: UserRole.ADMIN, tenantId: "t1" } };
      await ctrl.visible(req);
      const call = prisma.branch.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ tenantId: "t1", status: "active" });
    });
  });

  describe("CRUD forwarding", () => {
    const req = { user: { tenantId: "t1" } };
    it("list / one / create / update / archive are tenant-scoped", () => {
      ctrl.list(req);
      ctrl.one(req, "b1");
      ctrl.create(req, { name: "New" } as any);
      ctrl.update(req, "b1", { name: "N2" } as any);
      ctrl.archive(req, "b1");
      expect(branches.list).toHaveBeenCalledWith("t1");
      expect(branches.findOrThrow).toHaveBeenCalledWith("t1", "b1");
      expect(branches.create).toHaveBeenCalledWith("t1", { name: "New" });
      expect(branches.update).toHaveBeenCalledWith("t1", "b1", { name: "N2" });
      expect(branches.archive).toHaveBeenCalledWith("t1", "b1");
    });
  });
});
