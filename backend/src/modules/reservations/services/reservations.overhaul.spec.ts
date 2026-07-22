import { BadRequestException } from "@nestjs/common";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";
import { ReservationsService } from "./reservations.service";
import { ReservationStatus } from "../constants/reservation-status.enum";

/**
 * Reservations overhaul (spec §B1, B2, B4). Clocks are pinned where a date
 * boundary matters (pending-count UTC anchoring). Prisma is mocked; the
 * Serializable $transaction is run by invoking the callback against the same
 * mock client, matching the plan-gate spec's pattern.
 */
describe("ReservationsService — overhaul B1/B2/B4", () => {
  let prisma: MockPrismaClient;
  let gateway: {
    emitFloorLayoutUpdated: jest.Mock;
    emitReservationNew: jest.Mock;
    emitReservationUpdated: jest.Mock;
  };
  let notify: jest.Mock;

  const scope = {
    tenantId: "t-1",
    branchId: "b-1",
    userId: "u-1",
    role: "MANAGER",
  } as any;

  const buildSvc = (settings: any) => {
    const settingsService = {
      getOrCreate: jest.fn().mockResolvedValue(settings),
    } as any;
    notify = jest.fn().mockResolvedValue(undefined);
    return new ReservationsService(
      prisma as any,
      { notifyAdmins: jest.fn().mockResolvedValue(undefined) } as any,
      settingsService,
      { notify } as any,
      { resolvePublicBranchId: jest.fn().mockResolvedValue("b-1") } as any,
      undefined,
      undefined,
      gateway as any,
    );
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = {
      emitFloorLayoutUpdated: jest.fn(),
      emitReservationNew: jest.fn(),
      emitReservationUpdated: jest.fn(),
    };
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: "t-1",
      status: "ACTIVE",
    });
    // Run the create transaction callback against the mock client directly.
    (prisma as any).$transaction = jest.fn(async (cb: any) => cb(prisma));
  });

  // ---- B1: no-table double-booking guard -------------------------------

  describe("B1 — no-table conflict (branch has ≥1 table)", () => {
    const settings = {
      isEnabled: true,
      defaultDuration: 90,
      maxReservationsPerSlot: null,
    };

    it("REJECTS when no capacity-fitting table stays free (freeFitting ≤ overlapping no-table count)", async () => {
      const svc = buildSvc(settings);
      // Two capacity-4 tables; two overlapping no-table parties already hold
      // both implied seats → the third no-table booking has no spare table.
      (prisma.table.aggregate as any).mockResolvedValue({
        _max: { capacity: 4 },
      });
      (prisma.table.findMany as any).mockResolvedValue([
        { id: "tbl-1", capacity: 4 },
        { id: "tbl-2", capacity: 4 },
      ]);
      (prisma.reservation.findMany as any).mockResolvedValue([
        { tableId: null, startTime: "19:00", endTime: "21:00" },
        { tableId: null, startTime: "18:30", endTime: "20:00" },
      ]);

      await expect(
        svc.createStaffReservation(scope, {
          date: "2026-08-01",
          startTime: "19:00",
          endTime: "20:30",
          guestCount: 2,
          customerName: "Jane",
          customerPhone: "+905551234567",
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.reservation.create).not.toHaveBeenCalled();
    });

    it("ACCEPTS when a capacity-fitting table remains free after overlaps", async () => {
      const svc = buildSvc(settings);
      (prisma.table.aggregate as any).mockResolvedValue({
        _max: { capacity: 4 },
      });
      (prisma.table.findMany as any).mockResolvedValue([
        { id: "tbl-1", capacity: 4 },
        { id: "tbl-2", capacity: 4 },
      ]);
      // No overlapping rows → freeFitting = 2, overlapping no-table = 0 → 2 > 0.
      // The number-alloc scan (select.reservationNumber) returns [] separately.
      (prisma.reservation.findMany as any).mockImplementation((args: any) => {
        if (args?.select?.reservationNumber) return Promise.resolve([]);
        return Promise.resolve([]);
      });
      (prisma.reservation.findFirst as any).mockResolvedValue(null); // duplicate
      const created = {
        id: "r-1",
        status: ReservationStatus.CONFIRMED,
        source: "PHONE",
        date: new Date("2026-08-01"),
        reservationNumber: "R-20260801-0001",
        customerName: "Jane",
        customerEmail: null,
        customerPhone: "+905551234567",
      };
      (prisma.reservation.create as any).mockResolvedValue(created);

      const res = await svc.createStaffReservation(scope, {
        date: "2026-08-01",
        startTime: "19:00",
        endTime: "20:30",
        guestCount: 2,
        customerName: "Jane",
        customerPhone: "+905551234567",
      } as any);

      expect(res).toBe(created);
      expect(prisma.reservation.create).toHaveBeenCalledTimes(1);
    });

    it("REJECTS a party larger than the largest table BEFORE the transaction", async () => {
      const svc = buildSvc(settings);
      (prisma.table.aggregate as any).mockResolvedValue({
        _max: { capacity: 4 },
      });

      await expect(
        svc.createStaffReservation(scope, {
          date: "2026-08-01",
          startTime: "19:00",
          guestCount: 20,
          customerName: "Jane",
          customerPhone: "+905551234567",
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect((prisma as any).$transaction).not.toHaveBeenCalled();
    });
  });

  describe("B1 — zero-table fallback slot cap (maxReservationsPerSlot ?? 10)", () => {
    it("REJECTS the 11th no-table booking when the branch has 0 tables and no configured cap", async () => {
      const svc = buildSvc({
        isEnabled: true,
        defaultDuration: 90,
        maxReservationsPerSlot: null,
      });
      (prisma.table.aggregate as any).mockResolvedValue({
        _max: { capacity: null },
      });
      (prisma.table.findMany as any).mockResolvedValue([]); // zero tables
      (prisma.reservation.count as any).mockResolvedValue(10); // slot already at default cap

      await expect(
        svc.createStaffReservation(scope, {
          date: "2026-08-01",
          startTime: "19:00",
          guestCount: 2,
          customerName: "Jane",
          customerPhone: "+905551234567",
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.reservation.create).not.toHaveBeenCalled();
    });

    it("ACCEPTS when the branch has 0 tables and the slot is under the cap", async () => {
      const svc = buildSvc({
        isEnabled: true,
        defaultDuration: 90,
        maxReservationsPerSlot: null,
      });
      (prisma.table.aggregate as any).mockResolvedValue({
        _max: { capacity: null },
      });
      (prisma.table.findMany as any).mockResolvedValue([]);
      (prisma.reservation.count as any).mockResolvedValue(0);
      (prisma.reservation.findMany as any).mockResolvedValue([]); // number alloc
      (prisma.reservation.findFirst as any).mockResolvedValue(null); // duplicate
      const created = {
        id: "r-2",
        status: ReservationStatus.CONFIRMED,
        source: "PHONE",
        date: new Date("2026-08-01"),
        reservationNumber: "R-20260801-0001",
        customerName: "Jane",
        customerEmail: null,
        customerPhone: "+905551234567",
      };
      (prisma.reservation.create as any).mockResolvedValue(created);

      const res = await svc.createStaffReservation(scope, {
        date: "2026-08-01",
        startTime: "19:00",
        guestCount: 2,
        customerName: "Jane",
        customerPhone: "+905551234567",
      } as any);

      expect(res).toBe(created);
      expect(prisma.reservation.create).toHaveBeenCalledTimes(1);
    });
  });

  // ---- B2: staff create ------------------------------------------------

  describe("B2 — staff create", () => {
    const zeroTableSettings = {
      isEnabled: true,
      defaultDuration: 90,
      maxReservationsPerSlot: null,
    };

    const acceptZeroTableMocks = (created: any) => {
      (prisma.table.aggregate as any).mockResolvedValue({
        _max: { capacity: null },
      });
      (prisma.table.findMany as any).mockResolvedValue([]);
      (prisma.reservation.count as any).mockResolvedValue(0);
      (prisma.reservation.findMany as any).mockResolvedValue([]);
      (prisma.reservation.findFirst as any).mockResolvedValue(null);
      (prisma.reservation.create as any).mockResolvedValue(created);
    };

    it("defaults to CONFIRMED status, source PHONE, and endTime = start + defaultDuration", async () => {
      const svc = buildSvc(zeroTableSettings);
      const created = {
        id: "r-1",
        status: ReservationStatus.CONFIRMED,
        source: "PHONE",
        date: new Date("2026-08-01"),
        reservationNumber: "R-20260801-0001",
        customerName: "Jane",
        customerEmail: null,
        customerPhone: "+905551234567",
      };
      acceptZeroTableMocks(created);

      const res = await svc.createStaffReservation(scope, {
        date: "2026-08-01",
        startTime: "19:00",
        guestCount: 2,
        customerName: "Jane",
        customerPhone: "+905551234567",
      } as any);

      expect(res).toBe(created);
      const data = (prisma.reservation.create as any).mock.calls[0][0].data;
      expect(data.status).toBe(ReservationStatus.CONFIRMED);
      expect(data.source).toBe("PHONE");
      expect(data.endTime).toBe("20:30"); // 19:00 + 90m
      expect(data.confirmedAt).toBeInstanceOf(Date);
      expect(data.branchId).toBe("b-1");

      // Live event on create + PHONE customer notification (confirmed copy).
      expect(gateway.emitReservationNew).toHaveBeenCalledTimes(1);
      expect(gateway.emitReservationNew.mock.calls[0][2]).toEqual({
        reservationId: "r-1",
        status: ReservationStatus.CONFIRMED,
        date: "2026-08-01",
      });
      expect(notify).toHaveBeenCalledWith(
        "t-1",
        "confirmed",
        expect.objectContaining({ reservationNumber: "R-20260801-0001" }),
      );
    });

    it("WALKIN source sends NO customer notification", async () => {
      const svc = buildSvc(zeroTableSettings);
      const created = {
        id: "r-3",
        status: ReservationStatus.CONFIRMED,
        source: "WALKIN",
        date: new Date("2026-08-01"),
        reservationNumber: "R-20260801-0002",
        customerName: "Walk In",
        customerEmail: null,
        customerPhone: null,
      };
      acceptZeroTableMocks(created);

      await svc.createStaffReservation(scope, {
        date: "2026-08-01",
        startTime: "19:00",
        guestCount: 2,
        customerName: "Walk In",
        source: "WALKIN",
      } as any);

      expect(
        (prisma.reservation.create as any).mock.calls[0][0].data.source,
      ).toBe("WALKIN");
      expect(notify).not.toHaveBeenCalled();
      expect(gateway.emitReservationNew).toHaveBeenCalledTimes(1);
    });

    it("autoSeat=true requires a tableId", async () => {
      const svc = buildSvc(zeroTableSettings);
      await expect(
        svc.createStaffReservation(scope, {
          date: "2026-08-01",
          startTime: "19:00",
          guestCount: 2,
          customerName: "Walk In",
          source: "WALKIN",
          autoSeat: true,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect((prisma as any).$transaction).not.toHaveBeenCalled();
    });

    it("autoSeat=true creates then immediately seats via the guarded claim", async () => {
      const svc = buildSvc(zeroTableSettings);
      // Branch resolution + capacity (table path).
      (prisma.table.findFirst as any).mockResolvedValue({
        id: "tbl-1",
        tenantId: "t-1",
        branchId: "b-1",
        capacity: 4,
      });
      // Table-path overlap read + number alloc both empty.
      (prisma.reservation.findMany as any).mockResolvedValue([]);
      const createdConfirmed = {
        id: "r-4",
        status: ReservationStatus.CONFIRMED,
        source: "WALKIN",
        tableId: "tbl-1",
        branchId: "b-1",
        tenantId: "t-1",
        date: new Date("2026-08-01"),
        reservationNumber: "R-20260801-0003",
        customerName: "Walk In",
        customerEmail: null,
        customerPhone: null,
      };
      (prisma.reservation.create as any).mockResolvedValue(createdConfirmed);
      // seat(): findOne re-reads the CONFIRMED row, guarded claim wins, table
      // occupied, then the SEATED row is returned.
      (prisma.reservation.findFirst as any).mockResolvedValue(createdConfirmed);
      (prisma.reservation.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.table.updateMany as any).mockResolvedValue({ count: 1 });
      const seatedRow = {
        ...createdConfirmed,
        status: ReservationStatus.SEATED,
        table: { id: "tbl-1" },
      };
      (prisma.reservation.findFirstOrThrow as any).mockResolvedValue(seatedRow);

      const res = await svc.createStaffReservation(scope, {
        date: "2026-08-01",
        startTime: "19:00",
        guestCount: 2,
        customerName: "Walk In",
        source: "WALKIN",
        tableId: "tbl-1",
        autoSeat: true,
      } as any);

      expect((res as any).status).toBe(ReservationStatus.SEATED);
      // Same guarded claim as seat(): CONFIRMED → SEATED, table → OCCUPIED.
      const claimWhere = (prisma.reservation.updateMany as any).mock.calls[0][0]
        .where;
      expect(claimWhere.status).toBe(ReservationStatus.CONFIRMED);
      const occ = (prisma.table.updateMany as any).mock.calls[0][0];
      expect(occ.data.status).toBe("OCCUPIED");
      // seat() emitted floor refresh + reservation:updated (SEATED).
      expect(gateway.emitFloorLayoutUpdated).toHaveBeenCalled();
      expect(gateway.emitReservationUpdated).toHaveBeenCalled();
      // No customer notification for a walk-in.
      expect(notify).not.toHaveBeenCalled();
    });

    it("KEEPS the table overlap check (rejects a conflicting table booking)", async () => {
      const svc = buildSvc(zeroTableSettings);
      (prisma.table.findFirst as any).mockResolvedValue({
        id: "tbl-1",
        tenantId: "t-1",
        branchId: "b-1",
        capacity: 4,
      });
      (prisma.reservation.findMany as any).mockResolvedValue([
        { startTime: "19:00", endTime: "21:00", tableId: "tbl-1" },
      ]);

      await expect(
        svc.createStaffReservation(scope, {
          date: "2020-01-01", // PAST date — public gate would reject; staff skips it
          startTime: "19:00",
          endTime: "20:30",
          guestCount: 2,
          customerName: "Jane",
          tableId: "tbl-1",
        } as any),
      ).rejects.toThrow(/already reserved/i);
      expect(prisma.reservation.create).not.toHaveBeenCalled();
    });

    it("KEEPS the per-table capacity check", async () => {
      const svc = buildSvc(zeroTableSettings);
      (prisma.table.findFirst as any).mockResolvedValue({
        id: "tbl-1",
        tenantId: "t-1",
        branchId: "b-1",
        capacity: 4,
      });

      await expect(
        svc.createStaffReservation(scope, {
          date: "2026-08-01",
          startTime: "19:00",
          guestCount: 10, // exceeds capacity 4
          customerName: "Jane",
          tableId: "tbl-1",
        } as any),
      ).rejects.toThrow(/capacity/i);
      expect((prisma as any).$transaction).not.toHaveBeenCalled();
    });

    it("SKIPS the public advance-window/past-date gates (succeeds for a past date)", async () => {
      const svc = buildSvc(zeroTableSettings);
      const created = {
        id: "r-5",
        status: ReservationStatus.CONFIRMED,
        source: "PHONE",
        date: new Date("2020-01-01"),
        reservationNumber: "R-20200101-0001",
        customerName: "Jane",
        customerEmail: null,
        customerPhone: "+905551234567",
      };
      acceptZeroTableMocks(created);

      const res = await svc.createStaffReservation(scope, {
        date: "2020-01-01", // deep past — public create would 400
        startTime: "19:00",
        guestCount: 2,
        customerName: "Jane",
        customerPhone: "+905551234567",
      } as any);

      expect(res).toBe(created);
      expect(prisma.reservation.create).toHaveBeenCalledTimes(1);
    });
  });

  // ---- B4: range query + pending count ---------------------------------

  describe("B4 — findAll date range", () => {
    const settings = { isEnabled: true } as any;

    it("applies an inclusive UTC-anchored [dateFrom, dateTo] range", async () => {
      const svc = buildSvc(settings);
      (prisma.reservation.findMany as any).mockResolvedValue([]);
      (prisma.reservation.count as any).mockResolvedValue(0);

      await svc.findAll(scope, {
        dateFrom: "2026-07-01",
        dateTo: "2026-07-14",
      } as any);

      const where = (prisma.reservation.findMany as any).mock.calls[0][0].where;
      expect(where.date.gte.toISOString()).toBe("2026-07-01T00:00:00.000Z");
      expect(where.date.lte.toISOString()).toBe("2026-07-14T00:00:00.000Z");
    });

    it("lets `date` win over the range for back-compat when both are given", async () => {
      const svc = buildSvc(settings);
      (prisma.reservation.findMany as any).mockResolvedValue([]);
      (prisma.reservation.count as any).mockResolvedValue(0);

      await svc.findAll(scope, {
        date: "2026-07-05",
        dateFrom: "2026-07-01",
        dateTo: "2026-07-14",
      } as any);

      const where = (prisma.reservation.findMany as any).mock.calls[0][0].where;
      expect(where.date).toBeInstanceOf(Date);
      expect((where.date as Date).toISOString()).toBe(
        "2026-07-05T00:00:00.000Z",
      );
    });

    it("supports an open-ended range (dateFrom only)", async () => {
      const svc = buildSvc(settings);
      (prisma.reservation.findMany as any).mockResolvedValue([]);
      (prisma.reservation.count as any).mockResolvedValue(0);

      await svc.findAll(scope, { dateFrom: "2026-07-01" } as any);

      const where = (prisma.reservation.findMany as any).mock.calls[0][0].where;
      expect(where.date.gte.toISOString()).toBe("2026-07-01T00:00:00.000Z");
      expect(where.date.lte).toBeUndefined();
    });
  });

  describe("B4 — pending-count UTC anchoring", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      // 01:00 UTC on 2026-07-22 — UTC-today is 2026-07-22.
      jest.setSystemTime(new Date("2026-07-22T01:00:00.000Z"));
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it("counts PENDING rows with date >= UTC-today, branch-scoped", async () => {
      const svc = buildSvc({ isEnabled: true } as any);
      (prisma.reservation.count as any).mockResolvedValue(3);

      const res = await svc.getPendingCount(scope);

      expect(res).toEqual({ count: 3 });
      const where = (prisma.reservation.count as any).mock.calls[0][0].where;
      expect(where.tenantId).toBe("t-1");
      expect(where.branchId).toBe("b-1");
      expect(where.status).toBe(ReservationStatus.PENDING);
      expect((where.date.gte as Date).toISOString()).toBe(
        "2026-07-22T00:00:00.000Z",
      );
    });
  });
});
