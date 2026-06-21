import { NotFoundException } from "@nestjs/common";
import { ReservationsService } from "./reservations.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * [M22] Reservation admin update() must validate any incoming tableId against
 * the caller's branch scope before writing. The table FK is tenant-agnostic,
 * so without the guard an ADMIN/MANAGER scoped to branch A could PATCH the
 * reservation's tableId to a table belonging to branch B / another tenant —
 * the write would succeed (stale branchId) and include:{table:true} would
 * leak the foreign table's fields.
 */
describe("ReservationsService.update — tableId branch-scope guard (M22)", () => {
  let prisma: MockPrismaClient;
  let svc: ReservationsService;

  const scope = { tenantId: "t-1", branchId: "b-1" } as any;

  const existingReservation = {
    id: "r-1",
    tenantId: "t-1",
    branchId: "b-1",
    tableId: "table-a",
    guestCount: 2,
    date: new Date("2026-07-01"),
    startTime: "19:00",
    endTime: "21:00",
    status: "CONFIRMED",
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new ReservationsService(
      prisma as any,
      { notifyAdmins: jest.fn() } as any,
      { getOrCreate: jest.fn() } as any,
      { notify: jest.fn() } as any,
      { resolvePublicBranchId: jest.fn() } as any,
    );

    // findOne()
    (prisma.reservation.findFirst as any).mockResolvedValue(existingReservation);
    (prisma.reservation.update as any).mockResolvedValue({
      ...existingReservation,
    });
    // update() now runs the overlap-check + write inside a Serializable
    // $transaction; pass the callback the same mock so tx.reservation.* are the
    // asserted spies.
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      cb(prisma),
    );
  });

  it("rejects a tableId that is not in the caller's scope (no foreign-table write/leak)", async () => {
    // Scoped lookup finds nothing => foreign / cross-branch table.
    (prisma.table.findFirst as any).mockResolvedValue(null);

    await expect(
      svc.update(scope, "r-1", { tableId: "table-foreign" } as any),
    ).rejects.toBeInstanceOf(NotFoundException);

    // The scoped lookup must be tenant+branch pinned.
    const tableWhere = (prisma.table.findFirst as any).mock.calls[0][0].where;
    expect(tableWhere.id).toBe("table-foreign");
    expect(tableWhere.tenantId).toBe("t-1");
    expect(tableWhere.branchId).toBe("b-1");

    // Nothing was written.
    expect(prisma.reservation.update).not.toHaveBeenCalled();
  });

  it("accepts an in-scope tableId and writes the update", async () => {
    (prisma.table.findFirst as any).mockResolvedValue({
      id: "table-b",
      tenantId: "t-1",
      branchId: "b-1",
      capacity: 4,
    });
    (prisma.reservation.findMany as any).mockResolvedValue([]);

    await svc.update(scope, "r-1", { tableId: "table-b" } as any);

    expect(prisma.reservation.update).toHaveBeenCalledTimes(1);
    const data = (prisma.reservation.update as any).mock.calls[0][0].data;
    expect(data.tableId).toBe("table-b");
    // The reservation's branchId must NOT be rewritten from the table lookup.
    expect(data.branchId).toBeUndefined();
  });

  it("does not re-validate when tableId is unchanged", async () => {
    (prisma.reservation.findMany as any).mockResolvedValue([]);

    await svc.update(scope, "r-1", { tableId: "table-a" } as any);

    // Same tableId => no scoped table lookup, just the overlap read.
    expect(prisma.table.findFirst).not.toHaveBeenCalled();
    expect(prisma.reservation.update).toHaveBeenCalledTimes(1);
  });
});
