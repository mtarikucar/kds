import { StockSettingsService } from "./stock-settings.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Real-logic spec for StockSettingsService.
 *
 * The unit is the "get-or-create singleton with P2002 race recovery"
 * pattern (branchId: null tenant-wide row). Branches pinned:
 *  - get: existing → return it (no create); none → create; create races
 *    (P2002) → re-read and return the winner; non-P2002 → rethrow.
 *  - update: existing → updateMany then re-read; none → create; create
 *    races (P2002) → updateMany then re-read; non-P2002 → rethrow.
 */
describe("StockSettingsService", () => {
  const TENANT = "tenant-1";
  let prisma: MockPrismaClient;
  let svc: StockSettingsService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new StockSettingsService(prisma as any);
  });

  const WHERE = { tenantId: TENANT, branchId: null };

  describe("get", () => {
    it("returns the existing tenant-wide row without creating", async () => {
      (prisma.stockSettings.findFirst as any).mockResolvedValue({
        id: "ss-1",
      });

      const res = await svc.get(TENANT);

      expect(res).toEqual({ id: "ss-1" });
      expect(prisma.stockSettings.findFirst).toHaveBeenCalledWith({
        where: WHERE,
      });
      expect(prisma.stockSettings.create).not.toHaveBeenCalled();
    });

    it("creates a default row when none exists", async () => {
      (prisma.stockSettings.findFirst as any).mockResolvedValue(null);
      (prisma.stockSettings.create as any).mockResolvedValue({ id: "ss-new" });

      const res = await svc.get(TENANT);

      expect(prisma.stockSettings.create).toHaveBeenCalledWith({
        data: { tenantId: TENANT },
      });
      expect(res).toEqual({ id: "ss-new" });
    });

    it("recovers from a P2002 race by re-reading the winning row", async () => {
      (prisma.stockSettings.findFirst as any)
        .mockResolvedValueOnce(null) // first probe: none
        .mockResolvedValueOnce({ id: "ss-race" }); // post-conflict re-read
      (prisma.stockSettings.create as any).mockRejectedValue({ code: "P2002" });

      const res = await svc.get(TENANT);
      expect(res).toEqual({ id: "ss-race" });
    });

    it("rethrows a non-P2002 create error", async () => {
      (prisma.stockSettings.findFirst as any).mockResolvedValue(null);
      (prisma.stockSettings.create as any).mockRejectedValue({ code: "P5000" });

      await expect(svc.get(TENANT)).rejects.toMatchObject({ code: "P5000" });
    });
  });

  describe("update", () => {
    const DTO = { enableAutoDeduction: true } as any;

    it("updates the existing row then re-reads it", async () => {
      (prisma.stockSettings.findFirst as any).mockResolvedValue({ id: "ss-1" });
      (prisma.stockSettings.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.stockSettings.findFirstOrThrow as any).mockResolvedValue({
        id: "ss-1",
        enableAutoDeduction: true,
      });

      const res = await svc.update(DTO, TENANT);

      expect(prisma.stockSettings.updateMany).toHaveBeenCalledWith({
        where: WHERE,
        data: DTO,
      });
      expect(res).toEqual({ id: "ss-1", enableAutoDeduction: true });
      expect(prisma.stockSettings.create).not.toHaveBeenCalled();
    });

    it("creates a row carrying the dto when none exists", async () => {
      (prisma.stockSettings.findFirst as any).mockResolvedValue(null);
      (prisma.stockSettings.create as any).mockResolvedValue({
        id: "ss-new",
        enableAutoDeduction: true,
      });

      const res = await svc.update(DTO, TENANT);

      expect(prisma.stockSettings.create).toHaveBeenCalledWith({
        data: { tenantId: TENANT, enableAutoDeduction: true },
      });
      expect(res).toEqual({ id: "ss-new", enableAutoDeduction: true });
    });

    it("falls through to create when an existing row's updateMany matched 0 rows", async () => {
      // existing found, but the conditional updateMany lost the row → count 0
      // → does NOT return early, falls through to create.
      (prisma.stockSettings.findFirst as any).mockResolvedValue({ id: "ss-1" });
      (prisma.stockSettings.updateMany as any).mockResolvedValue({ count: 0 });
      (prisma.stockSettings.create as any).mockResolvedValue({ id: "ss-2" });

      const res = await svc.update(DTO, TENANT);
      expect(prisma.stockSettings.create).toHaveBeenCalled();
      expect(res).toEqual({ id: "ss-2" });
    });

    it("recovers from a P2002 on create by updating + re-reading", async () => {
      (prisma.stockSettings.findFirst as any).mockResolvedValue(null);
      (prisma.stockSettings.create as any).mockRejectedValue({ code: "P2002" });
      (prisma.stockSettings.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.stockSettings.findFirstOrThrow as any).mockResolvedValue({
        id: "ss-race",
      });

      const res = await svc.update(DTO, TENANT);
      expect(prisma.stockSettings.updateMany).toHaveBeenCalledWith({
        where: WHERE,
        data: DTO,
      });
      expect(res).toEqual({ id: "ss-race" });
    });

    it("rethrows a non-P2002 create error", async () => {
      (prisma.stockSettings.findFirst as any).mockResolvedValue(null);
      (prisma.stockSettings.create as any).mockRejectedValue({ code: "P9999" });

      await expect(svc.update(DTO, TENANT)).rejects.toMatchObject({
        code: "P9999",
      });
    });
  });
});
