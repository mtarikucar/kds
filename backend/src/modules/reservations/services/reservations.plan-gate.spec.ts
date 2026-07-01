import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ReservationsService } from "./reservations.service";
import { ReservationSettingsService } from "./reservation-settings.service";
import { ReservationAvailabilityService } from "./reservation-availability.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Finding #1 / #2 fake-working sweep #2 — the PUBLIC reservation surface is
 * @Public(), so PlanFeatureGuard short-circuits past it and does NOT enforce
 * the reservationSystem plan feature. These specs pin the server-side gate
 * (mirroring the admin guard via the entitlement engine) and the guestCount
 * availability constraint.
 *
 * Engine-set shape mirrors EntitlementService.getForTenant: a populated
 * `features` map means "trust the engine" (the production guard's branch).
 */
function engineWith(features: Record<string, boolean>) {
  return {
    getForTenant: jest
      .fn()
      .mockResolvedValue({ features, limits: {}, integrations: {} }),
  } as any;
}

describe("Reservation public plan-gate (finding #1)", () => {
  let prisma: MockPrismaClient;

  beforeEach(() => {
    prisma = mockPrismaClient();
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: "t-1",
      status: "ACTIVE",
    });
  });

  describe("ReservationSettingsService.getPublicSettings", () => {
    it("returns isEnabled:false when the plan does NOT grant reservationSystem", async () => {
      // Engine populated but the reservation feature is absent → not granted.
      const entitlements = engineWith({ "feature.advancedReports": true });
      const svc = new ReservationSettingsService(prisma as any, entitlements);
      (prisma.reservationSettings.findFirst as any).mockResolvedValue({
        id: "s1",
        tenantId: "t-1",
        isEnabled: true, // schema default — must NOT win over the plan gate
        maxAdvanceDays: 30,
      });

      const res = await svc.getPublicSettings("t-1");
      expect(res.isEnabled).toBe(false);
      expect(entitlements.getForTenant).toHaveBeenCalledWith("t-1", null);
    });

    it("returns isEnabled:true when the plan grants reservationSystem and settings enabled", async () => {
      const entitlements = engineWith({ "feature.reservationSystem": true });
      const svc = new ReservationSettingsService(prisma as any, entitlements);
      (prisma.reservationSettings.findFirst as any).mockResolvedValue({
        id: "s1",
        tenantId: "t-1",
        isEnabled: true,
        maxAdvanceDays: 30,
      });

      const res = await svc.getPublicSettings("t-1");
      expect(res.isEnabled).toBe(true);
    });

    it("falls back to plan-only when the engine has no grants (projector race)", async () => {
      const entitlements = engineWith({}); // empty engine
      const svc = new ReservationSettingsService(prisma as any, entitlements);
      (prisma.tenant.findUnique as any).mockResolvedValue({
        id: "t-1",
        status: "ACTIVE",
        featureOverrides: null,
        currentPlan: { reservationSystem: false },
      });
      (prisma.reservationSettings.findFirst as any).mockResolvedValue({
        id: "s1",
        tenantId: "t-1",
        isEnabled: true,
      });

      const res = await svc.getPublicSettings("t-1");
      expect(res.isEnabled).toBe(false);
    });
  });

  describe("ReservationsService.createPublicReservation", () => {
    function buildService(entitlements: any) {
      const settingsService = {
        getOrCreate: jest.fn().mockResolvedValue({ isEnabled: true }),
      } as any;
      const availability = {
        resolvePublicBranchId: jest.fn().mockResolvedValue("b-1"),
      } as any;
      return new ReservationsService(
        prisma as any,
        {} as any, // notificationsService
        settingsService,
        { notify: jest.fn() } as any, // reservationNotificationService
        availability,
        undefined, // metrics
        entitlements,
      );
    }

    const dto: any = {
      date: "2999-01-01",
      startTime: "19:00",
      endTime: "20:30",
      guestCount: 4,
      customerName: "Jane",
      customerPhone: "+905551234567",
    };

    it("throws Forbidden BEFORE persisting when reservationSystem is not granted", async () => {
      const entitlements = engineWith({ "feature.advancedReports": true });
      const svc = buildService(entitlements);

      await expect(
        svc.createPublicReservation("t-1", { ...dto }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // Never reached the create.
      expect((prisma.reservation.create as any)).not.toHaveBeenCalled();
      expect((prisma as any).$transaction).not.toHaveBeenCalled();
    });
  });
});

describe("ReservationAvailabilityService.getAvailableSlots — party-size capacity (finding #2)", () => {
  let prisma: MockPrismaClient;
  let settingsService: { getOrCreate: jest.Mock };

  const enabledEngine = () => engineWith({ "feature.reservationSystem": true });

  // Pin "now" to a Wednesday BEFORE the hardcoded 2026-07-01 test date so the
  // generated morning slots stay in the FUTURE (bookable). Otherwise these
  // pass only until the wall clock passes 2026-07-01's morning, after which
  // the availability logic correctly greys the past slots out.
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-24T00:00:00Z"));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    prisma = mockPrismaClient();
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: "t-1",
      status: "ACTIVE",
    });
    (prisma.branch.findFirst as any).mockResolvedValue({
      id: "b-1",
      tenantId: "t-1",
      status: "active",
    });
    settingsService = {
      getOrCreate: jest.fn().mockResolvedValue({
        isEnabled: true,
        // open 09:00–11:00 Wed, no caps, no advance buffer
        operatingHours: { wednesday: { open: "09:00", close: "11:00" } },
        timeSlotInterval: 30,
        defaultDuration: 60,
        minAdvanceBooking: 0,
        maxReservationsPerSlot: null,
      }),
    };
  });

  it("returns NO available slots when guestCount exceeds the largest table (NULL maxReservationsPerSlot)", async () => {
    // Largest table seats 8; ask for 20.
    (prisma.table.findMany as any).mockResolvedValue([
      { id: "tbl-1", capacity: 8 },
      { id: "tbl-2", capacity: 4 },
    ]);
    (prisma.reservation.findMany as any).mockResolvedValue([]);

    const svc = new ReservationAvailabilityService(
      prisma as any,
      settingsService as any,
      enabledEngine(),
    );

    // 2026-07-01 is a Wednesday.
    const out = await svc.getAvailableSlots("t-1", "2026-07-01", 20, "b-1");
    expect(out.length).toBeGreaterThan(0); // slots are generated...
    expect(out.every((s) => s.available === false)).toBe(true); // ...but none bookable
  });

  it("keeps slots available when a table can seat the party", async () => {
    (prisma.table.findMany as any).mockResolvedValue([
      { id: "tbl-1", capacity: 8 },
    ]);
    (prisma.reservation.findMany as any).mockResolvedValue([]);

    const svc = new ReservationAvailabilityService(
      prisma as any,
      settingsService as any,
      enabledEngine(),
    );

    const out = await svc.getAvailableSlots("t-1", "2026-07-01", 6, "b-1");
    expect(out.some((s) => s.available)).toBe(true);
  });

  it("returns [] when the plan does not grant reservationSystem", async () => {
    const svc = new ReservationAvailabilityService(
      prisma as any,
      settingsService as any,
      engineWith({ "feature.advancedReports": true }),
    );
    const out = await svc.getAvailableSlots("t-1", "2026-07-01", 2, "b-1");
    expect(out).toEqual([]);
  });

  // BLOCKER B regression: a reservation-enabled branch that has ZERO tables
  // defined must NOT grey out every slot on capacity grounds. Pre-fix the
  // empty capableTables array forced available:false for every slot, bricking
  // the no-table / walk-in flow. With the fix, zero tables ⇒ "table
  // management not in use" ⇒ slots stay bookable (still subject to the OTHER
  // gates: closed days, caps, advance buffer).
  it("keeps slots bookable when the branch has ZERO tables (no false grey-out)", async () => {
    (prisma.table.findMany as any).mockResolvedValue([]); // no tables at all
    (prisma.reservation.findMany as any).mockResolvedValue([]);

    const svc = new ReservationAvailabilityService(
      prisma as any,
      settingsService as any,
      enabledEngine(),
    );

    const out = await svc.getAvailableSlots("t-1", "2026-07-01", 4, "b-1");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.available)).toBe(true);
  });

  // Counterpart: a branch that DOES have tables still marks a too-big party's
  // slots unavailable (the original guard is preserved — we only skipped it
  // when there are zero tables). This re-asserts the first test in this block
  // is enforced by table-existence, not silently disabled.
  it("still marks slots unavailable when tables exist but none can seat the party", async () => {
    (prisma.table.findMany as any).mockResolvedValue([
      { id: "tbl-1", capacity: 8 },
      { id: "tbl-2", capacity: 4 },
    ]);
    (prisma.reservation.findMany as any).mockResolvedValue([]);

    const svc = new ReservationAvailabilityService(
      prisma as any,
      settingsService as any,
      enabledEngine(),
    );

    const out = await svc.getAvailableSlots("t-1", "2026-07-01", 20, "b-1");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.available === false)).toBe(true);
  });
});

describe("ReservationsService.createPublicReservation — no-table party too big (finding #2)", () => {
  let prisma: MockPrismaClient;

  beforeEach(() => {
    prisma = mockPrismaClient();
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: "t-1",
      status: "ACTIVE",
    });
  });

  it("rejects guestCount larger than the branch's largest table when no tableId", async () => {
    const settingsService = {
      getOrCreate: jest.fn().mockResolvedValue({
        isEnabled: true,
        maxGuestsPerReservation: 100,
      }),
    } as any;
    const availability = {
      resolvePublicBranchId: jest.fn().mockResolvedValue("b-1"),
    } as any;
    // Largest table in the branch seats 8.
    (prisma.table.aggregate as any).mockResolvedValue({
      _max: { capacity: 8 },
    });

    const svc = new ReservationsService(
      prisma as any,
      {} as any,
      settingsService,
      { notify: jest.fn() } as any,
      availability,
      undefined,
      engineWith({ "feature.reservationSystem": true }),
    );

    const dto: any = {
      date: "2999-01-01",
      startTime: "19:00",
      endTime: "20:30",
      guestCount: 20,
      customerName: "Jane",
      customerPhone: "+905551234567",
      // no tableId
    };

    await expect(svc.createPublicReservation("t-1", dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect((prisma.reservation.create as any)).not.toHaveBeenCalled();
  });

  // BLOCKER A regression: a reservation-enabled branch with ZERO tables
  // defined (new tenants are NOT auto-seeded tables) must still accept a
  // normal-sized no-table booking. Pre-fix, maxCapacity resolved to 0 and the
  // unconditional `guestCount > maxCapacity` guard (guestCount @Min(1))
  // rejected EVERY such booking with a false 400, bricking the walk-in flow.
  it("SUCCEEDS for a no-table booking when the branch has ZERO tables (no false 400)", async () => {
    const settingsService = {
      getOrCreate: jest.fn().mockResolvedValue({
        isEnabled: true,
        maxGuestsPerReservation: 100,
      }),
    } as any;
    const availability = {
      resolvePublicBranchId: jest.fn().mockResolvedValue("b-1"),
    } as any;
    // No tables defined for this branch ⇒ aggregate _max.capacity is null.
    (prisma.table.aggregate as any).mockResolvedValue({
      _max: { capacity: null },
    });
    // Run the create transaction callback against the mock client directly.
    (prisma as any).$transaction = jest.fn(async (cb: any) => cb(prisma));
    (prisma.reservation.findFirst as any).mockResolvedValue(null); // number alloc
    (prisma.reservation.count as any).mockResolvedValue(0);
    const created = {
      id: "r-1",
      reservationNumber: "R-29990101-001",
      customerName: "Jane",
      customerEmail: undefined,
      customerPhone: "+905551234567",
    };
    (prisma.reservation.create as any).mockResolvedValue(created);

    const svc = new ReservationsService(
      prisma as any,
      { notifyAdmins: jest.fn() } as any,
      settingsService,
      { notify: jest.fn().mockResolvedValue(undefined) } as any,
      availability,
      undefined,
      engineWith({ "feature.reservationSystem": true }),
    );

    const dto: any = {
      date: "2999-01-01",
      startTime: "19:00",
      endTime: "20:30",
      guestCount: 4, // normal party — bounded only by maxGuestsPerReservation
      customerName: "Jane",
      customerPhone: "+905551234567",
      // no tableId
    };

    const res = await svc.createPublicReservation("t-1", dto);
    expect(res).toBe(created);
    expect((prisma.reservation.create as any)).toHaveBeenCalledTimes(1);
    // The no-single-table guard must NOT fire when zero tables exist.
    expect((prisma.reservation.create as any).mock.calls[0][0].data).toEqual(
      expect.objectContaining({ branchId: "b-1", guestCount: 4 }),
    );
  });
});

describe("ReservationAvailabilityService.listPublicBranches — plan-gate (minor C)", () => {
  let prisma: MockPrismaClient;
  let settingsService: { getOrCreate: jest.Mock };

  beforeEach(() => {
    prisma = mockPrismaClient();
    settingsService = { getOrCreate: jest.fn() };
  });

  it("returns [] when the plan does NOT grant reservationSystem (no branch-roster leak)", async () => {
    const svc = new ReservationAvailabilityService(
      prisma as any,
      settingsService as any,
      engineWith({ "feature.advancedReports": true }),
    );

    const res = await svc.listPublicBranches("t-1");
    expect(res).toEqual([]);
    // Gated BEFORE any branch read — nothing leaked.
    expect((prisma.branch.findMany as any)).not.toHaveBeenCalled();
  });

  it("returns the active branch roster when reservationSystem IS granted", async () => {
    (prisma.branch.findMany as any).mockResolvedValue([
      { id: "b-1", name: "Kadıköy" },
      { id: "b-2", name: "Beşiktaş" },
    ]);
    const svc = new ReservationAvailabilityService(
      prisma as any,
      settingsService as any,
      engineWith({ "feature.reservationSystem": true }),
    );

    const res = await svc.listPublicBranches("t-1");
    expect(res).toEqual([
      { id: "b-1", name: "Kadıköy" },
      { id: "b-2", name: "Beşiktaş" },
    ]);
    const args = (prisma.branch.findMany as any).mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: "t-1", status: "active" });
    expect(args.select).toEqual({ id: true, name: true });
  });
});
