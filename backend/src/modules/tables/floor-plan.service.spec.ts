import { ConflictException, NotFoundException } from "@nestjs/common";
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
  let tables: { withUpcomingReservations: jest.Mock };
  let svc: FloorPlanService;

  const scope = { tenantId: "t1", branchId: "b1" };

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = { emitFloorLayoutUpdated: jest.fn() };
    // FloorPlanService delegates the reservation badge to TablesService; the
    // pass-through mock just stamps upcomingReservation:null so getPlan's
    // grouping/shape logic is what's under test.
    tables = {
      withUpcomingReservations: jest.fn(async (_s: any, ts: any[]) =>
        ts.map((t) => ({ ...t, upcomingReservation: null })),
      ),
    };
    svc = new FloorPlanService(prisma as any, gateway as any, tables as any);

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

    it("falls a table whose zone is gone back to unplaced instead of dropping it", async () => {
      // z-gone is not in the returned zones (e.g. concurrently deleted between
      // the two non-atomic reads) — the table must not vanish from the plan.
      (prisma.floorZone.findMany as any).mockResolvedValue([
        { id: "z1", name: "Kat 1", sortOrder: 0, elements: [] },
      ]);
      (prisma.table.findMany as any).mockResolvedValue([
        { id: "tb-orphan", number: "9", capacity: 4, status: "AVAILABLE", groupId: null, zoneId: "z-gone", posX: 0, posY: 0, width: 80, height: 80, rotation: 0, shape: "ROUND", _count: { orders: 0 } },
      ]);

      const plan = await svc.getPlan(scope as any);

      expect(plan.zones[0].tables).toHaveLength(0);
      expect(plan.unplacedTables.map((t) => t.id)).toEqual(["tb-orphan"]);
    });

    it("attaches upcomingReservation via TablesService", async () => {
      (prisma.floorZone.findMany as any).mockResolvedValue([]);
      (prisma.table.findMany as any).mockResolvedValue([
        { id: "tb1", number: "1", capacity: 2, status: "AVAILABLE", groupId: null, zoneId: null, posX: 0, posY: 0, width: 80, height: 80, rotation: 0, shape: "ROUND", _count: { orders: 0 } },
      ]);
      const plan = await svc.getPlan(scope as any);
      expect(tables.withUpcomingReservations).toHaveBeenCalledWith(scope, expect.any(Array));
      expect(plan.unplacedTables[0]).toHaveProperty("upcomingReservation", null);
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
      (prisma.floorZone.count as any).mockResolvedValue(3); // under the cap
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
      (prisma.floorElement.count as any).mockResolvedValue(0); // under the cap
      (prisma.floorElement.create as any).mockResolvedValue({ id: "e1" });
      await svc.createElement(scope as any, { zoneId: "z1", type: "BAR", x: 5, y: 6 } as any);
      const data = (prisma.floorElement.create as any).mock.calls[0][0].data;
      expect(data).toMatchObject({ zoneId: "z1", type: "BAR", tenantId: "t1", branchId: "b1" });
      expect(gateway.emitFloorLayoutUpdated).toHaveBeenCalledWith("t1", "b1", { zoneId: "z1" });
    });
  });

  describe("saveLayout", () => {
    it("rejects (404) when a target zone is not in the branch, before any write", async () => {
      (prisma.floorZone.findMany as any).mockResolvedValue([]); // none of the zoneIds resolve
      await expect(
        svc.saveLayout(scope as any, {
          tables: [{ id: "tb1", zoneId: "z-bad", posX: 0, posY: 0, width: 80, height: 80, rotation: 0, shape: "ROUND" }],
        } as any),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.table.updateMany).not.toHaveBeenCalled();
    });

    it("fails closed (404, no emit) when a table id matches no in-branch row", async () => {
      // zoneId null → no zone validation; the foreign/stale table id matches 0
      // rows, so the whole save must be rejected rather than silently dropped.
      (prisma.table.updateMany as any).mockResolvedValue({ count: 0 });
      await expect(
        svc.saveLayout(scope as any, {
          tables: [{ id: "tb-foreign", zoneId: null, posX: 0, posY: 0, width: 80, height: 80, rotation: 0, shape: "ROUND" }],
        } as any),
      ).rejects.toThrow(NotFoundException);
      expect(gateway.emitFloorLayoutUpdated).not.toHaveBeenCalled();
    });

    it("fails closed (404) when an element id matches no in-branch row", async () => {
      (prisma.table.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.floorElement.updateMany as any).mockResolvedValue({ count: 0 });
      await expect(
        svc.saveLayout(scope as any, {
          tables: [{ id: "tb1", zoneId: null, posX: 0, posY: 0, width: 80, height: 80, rotation: 0, shape: "ROUND" }],
          elements: [{ id: "e-foreign", x: 1, y: 2, width: 50, height: 60, rotation: 0 }],
        } as any),
      ).rejects.toThrow(NotFoundException);
      expect(gateway.emitFloorLayoutUpdated).not.toHaveBeenCalled();
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
    it("updates each zone's sortOrder scope-bound, returns the real count, and emits", async () => {
      (prisma.floorZone.updateMany as any).mockResolvedValue({ count: 1 });
      const res = await svc.reorderZones(scope as any, {
        zones: [
          { id: "z1", sortOrder: 1 },
          { id: "z2", sortOrder: 0 },
        ],
      } as any);
      expect((prisma.floorZone.updateMany as any).mock.calls[0][0]).toMatchObject({
        where: { id: "z1", tenantId: "t1", branchId: "b1" },
        data: { sortOrder: 1 },
      });
      expect(res).toEqual({ reordered: 2 });
      expect(gateway.emitFloorLayoutUpdated).toHaveBeenCalled();
    });

    it("reports reordered:0 and skips the emit when no ids matched (stale/cross-branch)", async () => {
      (prisma.floorZone.updateMany as any).mockResolvedValue({ count: 0 });
      const res = await svc.reorderZones(scope as any, {
        zones: [{ id: "z-stale", sortOrder: 0 }],
      } as any);
      expect(res).toEqual({ reordered: 0 });
      expect(gateway.emitFloorLayoutUpdated).not.toHaveBeenCalled();
    });
  });
});
