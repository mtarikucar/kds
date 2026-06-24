import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { FloorPlanService } from "./floor-plan.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";

/**
 * Unit specs for FloorPlanService — the 2D floor-plan model (zones, elements,
 * bulk layout save). Focus: branch-scoping (every WHERE carries tenantId +
 * branchId), the cross-branch zone IDOR guards, the delete-zone fallback
 * (tables → unplaced, elements removed), and that layout saves validate
 * target zones before writing. Prisma is mocked; $transaction is wired to run
 * its callback against the same mock (callback form) or Promise.all an array
 * (the reorder form).
 */
describe("FloorPlanService", () => {
  let prisma: MockPrismaClient;
  let gateway: { emitFloorLayoutUpdated: jest.Mock };
  let svc: FloorPlanService;

  const scope = { tenantId: "t1", branchId: "b1" };

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = { emitFloorLayoutUpdated: jest.fn() };
    svc = new FloorPlanService(prisma as any, gateway as any);

    (prisma.$transaction as any).mockImplementation(async (arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(prisma),
    );
  });

  describe("getPlan", () => {
    it("groups tables under their zone and collects unplaced tables", async () => {
      (prisma.floorZone.findMany as any).mockResolvedValue([
        { id: "z1", name: "Kat 1", sortOrder: 0, elements: [] },
        { id: "z2", name: "Bahçe", sortOrder: 1, elements: [] },
      ]);
      (prisma.table.findMany as any).mockResolvedValue([
        { id: "tb1", number: "1", capacity: 4, status: "AVAILABLE", groupId: null, zoneId: "z1", posX: 10, posY: 20, width: 80, height: 80, rotation: 0, shape: "ROUND", _count: { orders: 2 } },
        { id: "tb2", number: "2", capacity: 2, status: "OCCUPIED", groupId: null, zoneId: null, posX: 0, posY: 0, width: 80, height: 80, rotation: 0, shape: "SQUARE", _count: { orders: 0 } },
      ]);

      const plan = await svc.getPlan(scope as any);

      expect(plan.zones).toHaveLength(2);
      expect(plan.zones[0].tables).toHaveLength(1);
      expect(plan.zones[0].tables[0]).toMatchObject({ id: "tb1", activeOrderCount: 2, tableShape: "ROUND" });
      expect(plan.zones[1].tables).toHaveLength(0);
      expect(plan.unplacedTables).toHaveLength(1);
      expect(plan.unplacedTables[0].id).toBe("tb2");
    });

    it("scopes both queries to the branch", async () => {
      (prisma.floorZone.findMany as any).mockResolvedValue([]);
      (prisma.table.findMany as any).mockResolvedValue([]);
      await svc.getPlan(scope as any);
      expect((prisma.floorZone.findMany as any).mock.calls[0][0].where).toMatchObject({ tenantId: "t1", branchId: "b1" });
      expect((prisma.table.findMany as any).mock.calls[0][0].where).toMatchObject({ tenantId: "t1", branchId: "b1" });
    });
  });

  describe("createZone", () => {
    it("rejects a duplicate zone name", async () => {
      (prisma.floorZone.findFirst as any).mockResolvedValue({ id: "z-existing" });
      await expect(svc.createZone(scope as any, { name: "Kat 1" } as any)).rejects.toThrow(ConflictException);
      expect(prisma.floorZone.create).not.toHaveBeenCalled();
    });

    it("appends after the last zone (sortOrder = last+1) and emits", async () => {
      (prisma.floorZone.findFirst as any).mockResolvedValue(null); // name free
      (prisma.floorZone.findFirst as any).mockResolvedValueOnce(null); // name free
      (prisma.floorZone.findFirst as any).mockResolvedValueOnce(null);
      // second findFirst call (last sortOrder lookup) returns sortOrder 4
      (prisma.floorZone.findFirst as any)
        .mockReset()
        .mockResolvedValueOnce(null) // assertZoneNameFree
        .mockResolvedValueOnce({ sortOrder: 4 }); // last zone
      (prisma.floorZone.create as any).mockResolvedValue({ id: "z-new", sortOrder: 5 });

      await svc.createZone(scope as any, { name: "Teras" } as any);

      const createArg = (prisma.floorZone.create as any).mock.calls[0][0].data;
      expect(createArg.sortOrder).toBe(5);
      expect(createArg).toMatchObject({ tenantId: "t1", branchId: "b1", name: "Teras" });
      expect(gateway.emitFloorLayoutUpdated).toHaveBeenCalled();
    });
  });

  describe("deleteZone", () => {
    it("unplaces tables, removes elements, deletes the zone, emits", async () => {
      (prisma.floorZone.findFirst as any).mockResolvedValue({ id: "z1" });
      (prisma.table.updateMany as any).mockResolvedValue({ count: 3 });
      (prisma.floorElement.deleteMany as any).mockResolvedValue({ count: 2 });
      (prisma.floorZone.deleteMany as any).mockResolvedValue({ count: 1 });

      await svc.deleteZone(scope as any, "z1");

      expect((prisma.table.updateMany as any).mock.calls[0][0]).toMatchObject({
        where: { zoneId: "z1", tenantId: "t1", branchId: "b1" },
        data: { zoneId: null },
      });
      expect(prisma.floorElement.deleteMany).toHaveBeenCalledWith({
        where: { zoneId: "z1", tenantId: "t1", branchId: "b1" },
      });
      expect(gateway.emitFloorLayoutUpdated).toHaveBeenCalled();
    });

    it("404s when the zone is not in the branch", async () => {
      (prisma.floorZone.findFirst as any).mockResolvedValue(null);
      await expect(svc.deleteZone(scope as any, "z1")).rejects.toThrow(NotFoundException);
    });
  });

  describe("createElement", () => {
    it("rejects an element whose zone is not in the branch", async () => {
      (prisma.floorZone.findFirst as any).mockResolvedValue(null);
      await expect(
        svc.createElement(scope as any, { zoneId: "z-other", type: "WALL" } as any),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.floorElement.create).not.toHaveBeenCalled();
    });

    it("creates with branch scope stamped and emits", async () => {
      (prisma.floorZone.findFirst as any).mockResolvedValue({ id: "z1" });
      (prisma.floorElement.create as any).mockResolvedValue({ id: "e1" });
      await svc.createElement(scope as any, { zoneId: "z1", type: "BAR", x: 5, y: 6 } as any);
      const data = (prisma.floorElement.create as any).mock.calls[0][0].data;
      expect(data).toMatchObject({ zoneId: "z1", type: "BAR", tenantId: "t1", branchId: "b1" });
      expect(gateway.emitFloorLayoutUpdated).toHaveBeenCalledWith("t1", "b1", { zoneId: "z1" });
    });
  });

  describe("saveLayout", () => {
    it("rejects when a target zone is not in the branch (before any write)", async () => {
      (prisma.floorZone.findMany as any).mockResolvedValue([]); // none of the zoneIds resolve
      await expect(
        svc.saveLayout(scope as any, {
          tables: [{ id: "tb1", zoneId: "z-bad", posX: 0, posY: 0, width: 80, height: 80, rotation: 0, shape: "ROUND" }],
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.table.updateMany).not.toHaveBeenCalled();
    });

    it("persists table + element geometry scope-bound and emits", async () => {
      (prisma.floorZone.findMany as any).mockResolvedValue([{ id: "z1" }]);
      (prisma.table.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.floorElement.updateMany as any).mockResolvedValue({ count: 1 });

      const res = await svc.saveLayout(scope as any, {
        tables: [{ id: "tb1", zoneId: "z1", posX: 100, posY: 200, width: 90, height: 90, rotation: 45, shape: "RECT" }],
        elements: [{ id: "e1", x: 1, y: 2, width: 50, height: 60, rotation: 0 }],
      } as any);

      expect(res).toEqual({ tableCount: 1, elementCount: 1 });
      const tWhere = (prisma.table.updateMany as any).mock.calls[0][0].where;
      expect(tWhere).toMatchObject({ id: "tb1", tenantId: "t1", branchId: "b1" });
      const tData = (prisma.table.updateMany as any).mock.calls[0][0].data;
      expect(tData).toMatchObject({ zoneId: "z1", posX: 100, posY: 200, shape: "RECT" });
      expect(gateway.emitFloorLayoutUpdated).toHaveBeenCalledWith("t1", "b1", {});
    });

    it("allows unplacing a table (zoneId null) with no zone validation", async () => {
      (prisma.table.updateMany as any).mockResolvedValue({ count: 1 });
      const res = await svc.saveLayout(scope as any, {
        tables: [{ id: "tb1", zoneId: null, posX: 0, posY: 0, width: 80, height: 80, rotation: 0, shape: "ROUND" }],
      } as any);
      expect(res.tableCount).toBe(1);
      expect(prisma.floorZone.findMany).not.toHaveBeenCalled();
      expect((prisma.table.updateMany as any).mock.calls[0][0].data.zoneId).toBeNull();
    });
  });

  describe("reorderZones", () => {
    it("updates each zone's sortOrder scope-bound and emits", async () => {
      (prisma.floorZone.updateMany as any).mockResolvedValue({ count: 1 });
      await svc.reorderZones(scope as any, {
        zones: [
          { id: "z1", sortOrder: 1 },
          { id: "z2", sortOrder: 0 },
        ],
      } as any);
      expect((prisma.floorZone.updateMany as any).mock.calls[0][0]).toMatchObject({
        where: { id: "z1", tenantId: "t1", branchId: "b1" },
        data: { sortOrder: 1 },
      });
      expect(gateway.emitFloorLayoutUpdated).toHaveBeenCalled();
    });
  });
});
