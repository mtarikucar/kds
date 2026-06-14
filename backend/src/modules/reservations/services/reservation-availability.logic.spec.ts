import {
  ReservationAvailabilityService,
  timeToMinutes,
} from "./reservation-availability.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";
import { ReservationStatus } from "../constants/reservation-status.enum";

/**
 * Availability *algorithm* coverage for ReservationAvailabilityService.
 *
 * The sibling reservations.public-branch-scope.spec.ts pins the branch-scope
 * fix (which branch the reads target). These specs instead exercise the
 * computation that runs ON TOP of those reads — the overlap math, capacity
 * filter, slot-window generation, the tenant-validation guards, and the pure
 * timeToMinutes helper — none of which depend on a real DB and all of which
 * were previously e2e-only. Proving they are unit-testable is the point.
 */
describe("ReservationAvailabilityService — availability logic", () => {
  let prisma: MockPrismaClient;
  let svc: ReservationAvailabilityService;

  const activeTenant = { id: "t-1", status: "ACTIVE" };

  function makeSettings(overrides: Record<string, unknown> = {}) {
    return {
      isEnabled: true,
      operatingHours: null,
      timeSlotInterval: 30,
      defaultDuration: 60,
      minAdvanceBooking: 0,
      maxReservationsPerSlot: null,
      ...overrides,
    };
  }

  let settingsService: { getOrCreate: jest.Mock; getPublicSettings: jest.Mock };

  beforeEach(() => {
    prisma = mockPrismaClient();
    settingsService = {
      getOrCreate: jest.fn().mockResolvedValue(makeSettings()),
      getPublicSettings: jest.fn(),
    };
    svc = new ReservationAvailabilityService(prisma as any, settingsService as any);
    (prisma.tenant.findUnique as any).mockResolvedValue(activeTenant);
    // Default branch resolution returns an active branch for this tenant.
    (prisma.branch.findFirst as any).mockResolvedValue({
      id: "b-1",
      tenantId: "t-1",
      status: "active",
    });
  });

  describe("timeToMinutes (pure helper)", () => {
    it("converts HH:MM into minutes-since-midnight", () => {
      expect(timeToMinutes("00:00")).toBe(0);
      expect(timeToMinutes("09:00")).toBe(540);
      expect(timeToMinutes("19:30")).toBe(19 * 60 + 30);
      expect(timeToMinutes("23:59")).toBe(23 * 60 + 59);
    });
  });

  describe("validateTenant guards", () => {
    it("throws NotFound when the tenant does not exist", async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue(null);
      await expect(
        svc.getAvailableTables("t-1", "2026-07-01", "19:00", "21:00"),
      ).rejects.toThrow(/tenant not found/i);
    });

    it("throws Forbidden when the tenant is not ACTIVE", async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue({
        id: "t-1",
        status: "SUSPENDED",
      });
      await expect(
        svc.getAvailableTables("t-1", "2026-07-01", "19:00", "21:00"),
      ).rejects.toThrow(/not active/i);
    });
  });

  describe("getAvailableTables — overlap + capacity filter", () => {
    const t1 = { id: "tbl-1", number: 1, capacity: 4, section: "A" };
    const t2 = { id: "tbl-2", number: 2, capacity: 2, section: "A" };

    it("excludes a table whose existing reservation overlaps the requested window", async () => {
      (prisma.table.findMany as any).mockResolvedValue([t1, t2]);
      // tbl-1 booked 18:30–19:30 — overlaps a 19:00–21:00 request.
      (prisma.reservation.findMany as any).mockResolvedValue([
        {
          id: "r-1",
          tableId: "tbl-1",
          startTime: "18:30",
          endTime: "19:30",
          status: ReservationStatus.CONFIRMED,
        },
      ]);

      const out = await svc.getAvailableTables("t-1", "2026-07-01", "19:00", "21:00");

      // tbl-1 overlaps -> excluded; tbl-2 free -> included.
      expect(out.map((t) => t.id)).toEqual(["tbl-2"]);
      expect(out[0]).toEqual({ id: "tbl-2", number: 2, capacity: 2, section: "A" });
    });

    it("keeps a table whose reservation only touches the boundary (no overlap)", async () => {
      (prisma.table.findMany as any).mockResolvedValue([t1]);
      // Existing 17:00–19:00 ends exactly when the 19:00–21:00 request starts.
      // overlap test is strict: requestStart < resEnd && requestEnd > resStart,
      // so 19:00 < 19:00 is false => NOT an overlap.
      (prisma.reservation.findMany as any).mockResolvedValue([
        {
          id: "r-2",
          tableId: "tbl-1",
          startTime: "17:00",
          endTime: "19:00",
          status: ReservationStatus.SEATED,
        },
      ]);

      const out = await svc.getAvailableTables("t-1", "2026-07-01", "19:00", "21:00");
      expect(out.map((t) => t.id)).toEqual(["tbl-1"]);
    });

    it("excludes tables smaller than the requested guest count", async () => {
      (prisma.table.findMany as any).mockResolvedValue([t1, t2]);
      (prisma.reservation.findMany as any).mockResolvedValue([]);

      // guestCount=4: tbl-1(cap 4) ok, tbl-2(cap 2) too small.
      const out = await svc.getAvailableTables(
        "t-1",
        "2026-07-01",
        "19:00",
        "21:00",
        4,
      );
      expect(out.map((t) => t.id)).toEqual(["tbl-1"]);
    });

    it("only considers a table reserved if the reservation is for THAT table", async () => {
      (prisma.table.findMany as any).mockResolvedValue([t1, t2]);
      // Overlapping reservation belongs to tbl-1 only; tbl-2 must stay free.
      (prisma.reservation.findMany as any).mockResolvedValue([
        {
          id: "r-3",
          tableId: "tbl-1",
          startTime: "19:00",
          endTime: "20:00",
          status: ReservationStatus.PENDING,
        },
      ]);

      const out = await svc.getAvailableTables("t-1", "2026-07-01", "19:00", "21:00");
      expect(out.map((t) => t.id)).toEqual(["tbl-2"]);
    });

    it("queries only active reservation statuses bound to a table", async () => {
      (prisma.table.findMany as any).mockResolvedValue([]);
      (prisma.reservation.findMany as any).mockResolvedValue([]);

      await svc.getAvailableTables("t-1", "2026-07-01", "19:00", "21:00");

      const where = (prisma.reservation.findMany as any).mock.calls[0][0].where;
      expect(where.status.in).toEqual([
        ReservationStatus.PENDING,
        ReservationStatus.CONFIRMED,
        ReservationStatus.SEATED,
      ]);
      expect(where.tableId).toEqual({ not: null });
    });
  });

  describe("getAvailableSlots — window generation", () => {
    it("returns [] when reservations are disabled", async () => {
      settingsService.getOrCreate.mockResolvedValue(makeSettings({ isEnabled: false }));
      const out = await svc.getAvailableSlots("t-1", "2026-07-01");
      expect(out).toEqual([]);
    });

    it("returns [] when the day is marked closed in operatingHours", async () => {
      // 2026-07-01 is a Wednesday.
      settingsService.getOrCreate.mockResolvedValue(
        makeSettings({ operatingHours: { wednesday: { closed: true } } }),
      );
      const out = await svc.getAvailableSlots("t-1", "2026-07-01");
      expect(out).toEqual([]);
    });

    it("generates slots across the open window at the configured interval", async () => {
      // Open 09:00–11:00, 30m interval, 60m duration. A slot is generated
      // while currentMinutes + duration <= close => 09:00, 09:30, 10:00.
      settingsService.getOrCreate.mockResolvedValue(
        makeSettings({
          operatingHours: { wednesday: { open: "09:00", close: "11:00" } },
          timeSlotInterval: 30,
          defaultDuration: 60,
          minAdvanceBooking: 0,
        }),
      );
      (prisma.reservation.findMany as any).mockResolvedValue([]);

      const out = await svc.getAvailableSlots("t-1", "2026-07-01");
      expect(out.map((s) => s.time)).toEqual(["09:00", "09:30", "10:00"]);
      // No clock-blocking (minAdvanceBooking 0) and no caps => all available.
      expect(out.every((s) => s.available)).toBe(true);
    });

    it("marks a slot unavailable once it hits maxReservationsPerSlot", async () => {
      settingsService.getOrCreate.mockResolvedValue(
        makeSettings({
          operatingHours: { wednesday: { open: "09:00", close: "11:00" } },
          timeSlotInterval: 30,
          defaultDuration: 60,
          minAdvanceBooking: 0,
          maxReservationsPerSlot: 1,
        }),
      );
      // One existing reservation already at the 09:30 slot => that slot full.
      (prisma.reservation.findMany as any).mockResolvedValue([
        { startTime: "09:30", status: ReservationStatus.CONFIRMED },
      ]);

      const out = await svc.getAvailableSlots("t-1", "2026-07-01");
      const byTime = Object.fromEntries(out.map((s) => [s.time, s.available]));
      expect(byTime["09:00"]).toBe(true);
      expect(byTime["09:30"]).toBe(false); // at cap
      expect(byTime["10:00"]).toBe(true);
    });

    it("marks near-term slots unavailable when minAdvanceBooking has not elapsed", async () => {
      // Use TODAY so the early hours are in the past / inside the advance
      // window regardless of the wall clock, and a huge minAdvanceBooking so
      // every generated slot for today is blocked.
      const today = new Date();
      const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const weekday = today
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase();
      settingsService.getOrCreate.mockResolvedValue(
        makeSettings({
          operatingHours: { [weekday]: { open: "00:00", close: "02:00" } },
          timeSlotInterval: 30,
          defaultDuration: 60,
          // 100 years of advance notice => nothing today is bookable.
          minAdvanceBooking: 100 * 365 * 24 * 60,
        }),
      );
      (prisma.reservation.findMany as any).mockResolvedValue([]);

      const out = await svc.getAvailableSlots("t-1", dateStr);
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((s) => s.available === false)).toBe(true);
    });
  });
});
