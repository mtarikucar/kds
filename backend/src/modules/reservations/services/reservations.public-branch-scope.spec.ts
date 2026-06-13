import { ReservationAvailabilityService } from "./reservation-availability.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * Track-1 branch-scope hardening (Task 8).
 *
 * The AUTHENTICATED admin paths already spread branchScope(scope). The
 * leak is in the PUBLIC (@SkipBranchScope) availability reads:
 * getAvailableTables / getAvailableSlots used `where: { tenantId }` and so
 * returned EVERY branch's tables/slots to an anonymous caller of a
 * multi-branch tenant.
 *
 * These specs pin the fix: public availability reads must scope to the
 * SAME single branch the booking will land in — the explicit branchId
 * when valid, else the oldest-active branch (the same resolution
 * createPublicReservation already uses).
 */
describe("ReservationAvailabilityService — public availability branch scoping (Task 8)", () => {
  let prisma: MockPrismaClient;
  let svc: ReservationAvailabilityService;

  const activeTenant = { id: "t-1", status: "ACTIVE" };
  const enabledSettings = {
    isEnabled: true,
    operatingHours: null,
    timeSlotInterval: 30,
    defaultDuration: 60,
    minAdvanceBooking: 0,
    maxReservationsPerSlot: null,
  };

  beforeEach(() => {
    prisma = mockPrismaClient();

    const settingsService = {
      getOrCreate: jest.fn().mockResolvedValue(enabledSettings),
      getPublicSettings: jest.fn(),
    } as any;

    svc = new ReservationAvailabilityService(prisma as any, settingsService);

    // Tenant is valid+active by default.
    (prisma.tenant.findUnique as any).mockResolvedValue(activeTenant);
  });

  describe("getAvailableTables", () => {
    it("scopes to the resolved branch (no cross-branch table leak)", async () => {
      (prisma.branch.findFirst as any).mockResolvedValue({
        id: "b-1",
        tenantId: "t-1",
        status: "active",
      });
      (prisma.table.findMany as any).mockResolvedValue([]);
      (prisma.reservation.findMany as any).mockResolvedValue([]);

      await svc.getAvailableTables("t-1", "2026-07-01", "19:00", "21:00", 2, "b-1");

      const tableWhere = (prisma.table.findMany as any).mock.calls[0][0].where;
      expect(tableWhere.branchId).toBe("b-1");
      expect(tableWhere.tenantId).toBe("t-1");

      // The overlap-reservation read must be scoped too.
      const resWhere = (prisma.reservation.findMany as any).mock.calls[0][0]
        .where;
      expect(resWhere.branchId).toBe("b-1");
      expect(resWhere.tenantId).toBe("t-1");

      // Validation query was tenant+branch+active scoped.
      const branchWhere = (prisma.branch.findFirst as any).mock.calls[0][0]
        .where;
      expect(branchWhere.id).toBe("b-1");
      expect(branchWhere.tenantId).toBe("t-1");
      expect(branchWhere.status).toBe("active");
    });

    it("rejects a branchId from another tenant", async () => {
      // findFirst returns null => not found for this tenant.
      (prisma.branch.findFirst as any).mockResolvedValue(null);

      await expect(
        svc.getAvailableTables(
          "t-1",
          "2026-07-01",
          "19:00",
          "21:00",
          2,
          "b-other",
        ),
      ).rejects.toBeTruthy();
    });

    it("with no branchId, resolves the oldest-active branch and scopes by it", async () => {
      (prisma.branch.findFirst as any).mockResolvedValue({ id: "b-oldest" });
      (prisma.table.findMany as any).mockResolvedValue([]);
      (prisma.reservation.findMany as any).mockResolvedValue([]);

      await svc.getAvailableTables("t-1", "2026-07-01", "19:00", "21:00", 2);

      // No branchId => oldest-active resolution: status=active, oldest first.
      const branchCall = (prisma.branch.findFirst as any).mock.calls[0][0];
      expect(branchCall.where.tenantId).toBe("t-1");
      expect(branchCall.where.status).toBe("active");
      expect(branchCall.orderBy).toEqual({ createdAt: "asc" });

      const tableWhere = (prisma.table.findMany as any).mock.calls[0][0].where;
      expect(tableWhere.branchId).toBe("b-oldest");
      expect(tableWhere.tenantId).toBe("t-1");
    });
  });

  describe("listPublicBranches", () => {
    it("returns active branches (id+name only) oldest-first, tenant-scoped", async () => {
      (prisma.branch.findMany as any).mockResolvedValue([
        { id: "b-1", name: "Kadıköy" },
        { id: "b-2", name: "Beşiktaş" },
      ]);

      const res = await svc.listPublicBranches("t-1");

      const args = (prisma.branch.findMany as any).mock.calls[0][0];
      // Only active branches of THIS tenant are bookable by the public.
      expect(args.where).toEqual({ tenantId: "t-1", status: "active" });
      // Oldest-first so the first entry is the same default resolvePublicBranchId picks.
      expect(args.orderBy).toEqual({ createdAt: "asc" });
      // Public-safe projection: never leak more than the picker needs.
      expect(args.select).toEqual({ id: true, name: true });
      expect(res).toEqual([
        { id: "b-1", name: "Kadıköy" },
        { id: "b-2", name: "Beşiktaş" },
      ]);
    });
  });

  describe("getAvailableSlots", () => {
    it("scopes the existing-reservation read to the resolved branch", async () => {
      (prisma.branch.findFirst as any).mockResolvedValue({
        id: "b-1",
        tenantId: "t-1",
        status: "active",
      });
      (prisma.reservation.findMany as any).mockResolvedValue([]);

      await svc.getAvailableSlots("t-1", "2026-07-01", 2, "b-1");

      const resWhere = (prisma.reservation.findMany as any).mock.calls[0][0]
        .where;
      expect(resWhere.branchId).toBe("b-1");
      expect(resWhere.tenantId).toBe("t-1");
    });

    it("rejects a branchId from another tenant", async () => {
      (prisma.branch.findFirst as any).mockResolvedValue(null);

      await expect(
        svc.getAvailableSlots("t-1", "2026-07-01", 2, "b-other"),
      ).rejects.toBeTruthy();
    });

    it("with no branchId, resolves the oldest-active branch and scopes by it", async () => {
      (prisma.branch.findFirst as any).mockResolvedValue({ id: "b-oldest" });
      (prisma.reservation.findMany as any).mockResolvedValue([]);

      await svc.getAvailableSlots("t-1", "2026-07-01", 2);

      const resWhere = (prisma.reservation.findMany as any).mock.calls[0][0]
        .where;
      expect(resWhere.branchId).toBe("b-oldest");
      expect(resWhere.tenantId).toBe("t-1");
    });
  });
});
