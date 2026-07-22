import { ConflictException } from "@nestjs/common";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";
import { ReservationsService } from "./reservations.service";
import { ReservationStatus } from "../constants/reservation-status.enum";

/**
 * Regression specs for the /loop reservations review (fix/reservations-hold-and-tz):
 *  - remove() must release a table's auto-hold BEFORE deleting the row, else
 *    the FK onDelete:SetNull strands the table in RESERVED forever (neither
 *    cron can reclaim it).
 *  - getStats() must key the @db.Date query at UTC midnight to match how
 *    reservations are STORED (new Date(dto.date)); the old process-local
 *    new Date(y,m,d) returned the day-before's counts on a server east of UTC.
 *  - the status transitions must claim via a status-guarded updateMany and
 *    surface a 409 when they lose the race, instead of clobbering a concurrent
 *    transition with a read-then-write.
 */
describe("ReservationsService — hold-lifecycle + @db.Date (loop review)", () => {
  let prisma: MockPrismaClient;
  let svc: ReservationsService;
  const scope = {
    tenantId: "t-1",
    branchId: "b-1",
    userId: "u-1",
    role: "MANAGER",
  } as any;

  const buildSvc = () =>
    new ReservationsService(
      prisma as any,
      { notifyAdmins: jest.fn() } as any,
      { getOrCreate: jest.fn(), getPublicSettings: jest.fn() } as any,
      { notify: jest.fn().mockResolvedValue(undefined) } as any,
      { resolvePublicBranchId: jest.fn() } as any,
      undefined,
      undefined,
      undefined,
    );

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = buildSvc();
  });

  describe("remove()", () => {
    it("releases the assigned table's auto-hold before deleting the reservation", async () => {
      (prisma.reservation.findFirst as any).mockResolvedValue({
        id: "r-1",
        tableId: "tbl-1",
        branchId: "b-1",
        tenantId: "t-1",
      });
      (prisma.table.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.reservation.delete as any).mockResolvedValue({ id: "r-1" });

      await svc.remove(scope, "r-1");

      // The hold release is scoped to THIS reservation's id (releaseHoldIfOwned)
      // so it only reverts a table we actually hold.
      const relWhere = (prisma.table.updateMany as any).mock.calls[0][0].where;
      expect(relWhere).toEqual({ id: "tbl-1", reservationHoldId: "r-1" });
      // And it happens before the delete.
      const relOrder = (prisma.table.updateMany as any).mock
        .invocationCallOrder[0];
      const delOrder = (prisma.reservation.delete as any).mock
        .invocationCallOrder[0];
      expect(relOrder).toBeLessThan(delOrder);
    });

    it("skips the table write for a table-less reservation but still deletes", async () => {
      (prisma.reservation.findFirst as any).mockResolvedValue({
        id: "r-2",
        tableId: null,
        branchId: "b-1",
        tenantId: "t-1",
      });
      (prisma.reservation.delete as any).mockResolvedValue({ id: "r-2" });

      await svc.remove(scope, "r-2");

      expect(prisma.table.updateMany).not.toHaveBeenCalled();
      expect(prisma.reservation.delete).toHaveBeenCalledTimes(1);
    });
  });

  describe("getStats()", () => {
    it("queries the @db.Date column at UTC midnight derived from the date string", async () => {
      (prisma.reservation.findMany as any).mockResolvedValue([]);

      await svc.getStats(scope, "2026-06-25");

      const where = (prisma.reservation.findMany as any).mock.calls[0][0].where;
      expect(where.tenantId).toBe("t-1");
      expect(where.branchId).toBe("b-1");
      // UTC midnight — matches `new Date(dto.date)` used on the write path,
      // NOT process-local `new Date(2026, 5, 25)` (which on UTC+3 would key
      // the previous calendar day).
      expect((where.date as Date).toISOString()).toBe(
        "2026-06-25T00:00:00.000Z",
      );
    });

    it("rejects a malformed date instead of sending an Invalid Date to Prisma", async () => {
      await expect(svc.getStats(scope, "not-a-date")).rejects.toThrow(
        /invalid date/i,
      );
      expect(prisma.reservation.findMany).not.toHaveBeenCalled();
    });
  });

  describe("status-transition claim guard", () => {
    it("seat() throws 409 when the guarded claim loses the race (count 0)", async () => {
      (prisma.reservation.findFirst as any).mockResolvedValue({
        id: "r-3",
        status: ReservationStatus.CONFIRMED,
        tableId: null,
        branchId: "b-1",
        tenantId: "t-1",
      });
      // A concurrent transition already moved the row out of CONFIRMED.
      (prisma.reservation.updateMany as any).mockResolvedValue({ count: 0 });

      await expect(svc.seat(scope, "r-3")).rejects.toBeInstanceOf(
        ConflictException,
      );
      // Must NOT re-read / return a row after losing the claim.
      expect(prisma.reservation.findFirstOrThrow).not.toHaveBeenCalled();
    });

    it("seat() claims via a status-guarded updateMany on CONFIRMED and re-reads on success", async () => {
      (prisma.reservation.findFirst as any).mockResolvedValue({
        id: "r-4",
        status: ReservationStatus.CONFIRMED,
        tableId: "tbl-9",
        branchId: "b-1",
        tenantId: "t-1",
      });
      (prisma.reservation.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.table.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.reservation.findFirstOrThrow as any).mockResolvedValue({
        id: "r-4",
        status: ReservationStatus.SEATED,
        table: { id: "tbl-9" },
      });

      const res = await svc.seat(scope, "r-4");

      const claimWhere = (prisma.reservation.updateMany as any).mock.calls[0][0]
        .where;
      expect(claimWhere.id).toBe("r-4");
      expect(claimWhere.tenantId).toBe("t-1");
      expect(claimWhere.branchId).toBe("b-1");
      expect(claimWhere.status).toBe(ReservationStatus.CONFIRMED);
      // The occupy write must not steal a table held/occupied by another row.
      const occWhere = (prisma.table.updateMany as any).mock.calls[0][0].where;
      expect(occWhere.status).toEqual({ in: ["AVAILABLE", "RESERVED"] });
      expect(occWhere.OR).toEqual([
        { reservationHoldId: null },
        { reservationHoldId: "r-4" },
      ]);
      expect((res as any).status).toBe(ReservationStatus.SEATED);
    });
  });
});
