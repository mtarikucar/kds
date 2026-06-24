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
});
