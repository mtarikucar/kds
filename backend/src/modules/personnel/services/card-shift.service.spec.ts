import { ConflictException, NotFoundException } from "@nestjs/common";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";
import { AttendanceService } from "./attendance.service";
import { CardShiftService } from "./card-shift.service";
import {
  AttendanceSource,
  AttendanceStatus,
} from "../constants/personnel.enum";
import { cardUidHash } from "../card-uid";

/**
 * The tap endpoint is the only thing standing between a plastic card and an
 * attendance row. Two properties carry the weight: it must never leak whether
 * an unknown card exists somewhere else, and it must never write attendance
 * itself — every late/break/overtime/overnight rule lives in AttendanceService
 * and a second implementation would drift from it silently.
 */
describe("CardShiftService.tap", () => {
  let prisma: MockPrismaClient;
  let attendance: jest.Mocked<
    Pick<AttendanceService, "clockIn" | "clockOut" | "breakEnd">
  >;
  let svc: CardShiftService;
  let warn: jest.SpyInstance;

  const TENANT = "t-1";
  const UID = "04:A2:2B:9C";
  const STAFF = {
    id: "u-1",
    firstName: "Ada",
    lastName: "Lovelace",
    role: "WAITER",
  };

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = "k".repeat(48);
    prisma = mockPrismaClient();
    attendance = {
      clockIn: jest.fn().mockResolvedValue({ id: "a-1" }),
      clockOut: jest.fn().mockResolvedValue({ id: "a-1" }),
      breakEnd: jest.fn().mockResolvedValue({ id: "a-1" }),
    } as any;
    svc = new CardShiftService(prisma as any, attendance as any);
    warn = jest.spyOn((svc as any).logger, "warn").mockImplementation(() => {});
    (prisma.user.findFirst as any).mockResolvedValue(STAFF);
    (prisma.attendance.findFirst as any).mockResolvedValue(null);
  });

  afterEach(() => warn.mockRestore());

  it("clocks in on the first tap of the day", async () => {
    const res = await svc.tap(TENANT, { cardUid: UID });

    expect(res.action).toBe("clockIn");
    expect(attendance.clockIn).toHaveBeenCalledWith(
      TENANT,
      "u-1",
      undefined,
      AttendanceSource.CARD,
    );
  });

  it("clocks out on the second tap", async () => {
    (prisma.attendance.findFirst as any).mockResolvedValue({
      id: "a-1",
      status: AttendanceStatus.CLOCKED_IN,
      updatedAt: new Date(Date.now() - 60_000),
    });

    const res = await svc.tap(TENANT, { cardUid: UID });

    expect(res.action).toBe("clockOut");
    expect(attendance.clockOut).toHaveBeenCalledWith(
      TENANT,
      "u-1",
      AttendanceSource.CARD,
    );
  });

  it("ends the break when the staff member is ON_BREAK", async () => {
    // Locking a staff member out with an error because they are on a break is
    // not acceptable at a kiosk with no other control.
    (prisma.attendance.findFirst as any).mockResolvedValue({
      id: "a-1",
      status: AttendanceStatus.ON_BREAK,
      updatedAt: new Date(Date.now() - 60_000),
    });

    const res = await svc.tap(TENANT, { cardUid: UID });

    expect(res.action).toBe("breakEnd");
    expect(attendance.breakEnd).toHaveBeenCalledWith(TENANT, "u-1");
  });

  it("ignores a duplicate tap inside the 10s debounce window", async () => {
    // HID readers can write one card twice. The second write would otherwise
    // close the shift the first one just opened.
    (prisma.attendance.findFirst as any).mockResolvedValue({
      id: "a-1",
      status: AttendanceStatus.CLOCKED_IN,
      updatedAt: new Date(Date.now() - 2_000),
    });

    const res = await svc.tap(TENANT, { cardUid: UID });

    expect(res.action).toBe("ignored");
    expect(res.attendance).toBeNull();
    expect(attendance.clockOut).not.toHaveBeenCalled();
  });

  it("404s an unknown card without revealing whether it exists in another tenant", async () => {
    (prisma.user.findFirst as any).mockResolvedValue(null);

    await expect(svc.tap(TENANT, { cardUid: UID })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const where = (prisma.user.findFirst as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe(TENANT);
  });

  it("404s a card belonging to an INACTIVE user", async () => {
    // Same body as an unknown card: a distinct error would confirm the card
    // exists and only the person is disabled.
    await svc.tap(TENANT, { cardUid: UID }).catch(() => undefined);
    const where = (prisma.user.findFirst as any).mock.calls[0][0].where;
    expect(where.status).toBe("ACTIVE");
  });

  it("400s a UID that is too short once normalised", async () => {
    await expect(svc.tap(TENANT, { cardUid: "0:4:A" })).rejects.toThrow(
      /CARD_UID_INVALID|geçersiz/i,
    );
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("never logs or returns the raw UID or the hash", async () => {
    (prisma.user.findFirst as any).mockResolvedValue(null);

    await svc.tap(TENANT, { cardUid: UID }).catch(() => undefined);

    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("2B9C"); // last4 is the only affordance
    expect(logged).not.toContain("04A22B9C");
    expect(logged).not.toContain(cardUidHash(TENANT, UID));
  });

  it("matches on the tenant-scoped hash, never on a stored plaintext UID", async () => {
    await svc.tap(TENANT, { cardUid: UID });
    const where = (prisma.user.findFirst as any).mock.calls[0][0].where;
    expect(where.staffCardUidHash).toBe(cardUidHash(TENANT, UID));
  });

  it("repackages an already-clocked-out day as 409 ALREADY_CLOCKED_OUT_TODAY", async () => {
    const { BadRequestException } = await import("@nestjs/common");
    attendance.clockIn.mockRejectedValue(
      new BadRequestException("Already clocked out today. Cannot clock in again."),
    );

    await expect(svc.tap(TENANT, { cardUid: UID })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("delegates to AttendanceService rather than writing attendance itself", async () => {
    await svc.tap(TENANT, { cardUid: UID });
    expect(prisma.attendance.create).not.toHaveBeenCalled();
    expect(prisma.attendance.updateMany).not.toHaveBeenCalled();
  });
});

describe("CardShiftService assignment surface", () => {
  let prisma: MockPrismaClient;
  let svc: CardShiftService;
  const TENANT = "t-1";

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = "k".repeat(48);
    prisma = mockPrismaClient();
    svc = new CardShiftService(prisma as any, {} as any);
  });

  it("stores hash + reversible copy + last4, never the raw UID", async () => {
    (prisma.user.findFirst as any).mockResolvedValue({ id: "u-1" });
    (prisma.user.update as any).mockResolvedValue({
      id: "u-1",
      firstName: "Ada",
      lastName: "Lovelace",
      role: "WAITER",
      staffCardLast4: "2B9C",
      staffCardAssignedAt: new Date("2026-08-20T10:00:00Z"),
      staffCardAssignedById: "u-admin",
    });

    const view = await svc.assign(TENANT, "u-1", "u-admin", {
      cardUid: "04:A2:2B:9C",
    });

    const data = (prisma.user.update as any).mock.calls[0][0].data;
    expect(data.staffCardUidHash).toHaveLength(64);
    expect(data.staffCardUidEnc.startsWith("v2:")).toBe(true);
    expect(data.staffCardLast4).toBe("2B9C");
    expect(data.staffCardHashVersion).toBe(1);
    expect(JSON.stringify(data)).not.toContain("04A22B9C");
    expect(view.last4).toBe("2B9C");
    expect(JSON.stringify(view)).not.toContain("staffCardUidHash");
  });

  it("assign only targets a user already confirmed to belong to this tenant", async () => {
    // The mocked count/row on user.update would pass even if the existence
    // check above it silently dropped tenantId — assert the WHERE clause
    // itself, not just the eventual behaviour, so a regression here cannot
    // hide behind a mock that returns success regardless of what it's asked.
    (prisma.user.findFirst as any).mockResolvedValue({ id: "u-1" });
    (prisma.user.update as any).mockResolvedValue({
      id: "u-1",
      firstName: "Ada",
      lastName: "Lovelace",
      role: "WAITER",
      staffCardLast4: "2B9C",
      staffCardAssignedAt: new Date(),
      staffCardAssignedById: "u-admin",
    });

    await svc.assign(TENANT, "u-1", "u-admin", { cardUid: "04:A2:2B:9C" });

    const where = (prisma.user.findFirst as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.id).toBe("u-1");
  });

  it("nulls every card column on revoke and keeps past attendance", async () => {
    (prisma.user.updateMany as any).mockResolvedValue({ count: 1 });

    await svc.revoke(TENANT, "u-1");

    const call = (prisma.user.updateMany as any).mock.calls[0][0];
    // Structural check, not just the mocked count: a `where` that dropped
    // tenantId would still make this test's mock return count:1, so the
    // WHERE clause itself has to be asserted or the check proves nothing.
    expect(call.where).toEqual({ id: "u-1", tenantId: TENANT });
    expect(call.data).toEqual({
      staffCardUidHash: null,
      staffCardUidEnc: null,
      staffCardLast4: null,
      staffCardAssignedAt: null,
      staffCardAssignedById: null,
    });
    expect(prisma.attendance.deleteMany).not.toHaveBeenCalled();
  });

  it("404s revoking a user that is not in this tenant", async () => {
    (prisma.user.updateMany as any).mockResolvedValue({ count: 0 });
    await expect(svc.revoke(TENANT, "u-other")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("lists only the last 4 digits — never the hash or the ciphertext", async () => {
    (prisma.user.findMany as any).mockResolvedValue([
      {
        id: "u-1",
        firstName: "Ada",
        lastName: "Lovelace",
        role: "WAITER",
        staffCardLast4: "2B9C",
        staffCardAssignedAt: new Date("2026-08-20T10:00:00Z"),
        staffCardAssignedById: "u-admin",
      },
    ]);

    const rows = await svc.list(TENANT);

    const select = (prisma.user.findMany as any).mock.calls[0][0].select;
    expect(select.staffCardUidHash).toBeUndefined();
    expect(select.staffCardUidEnc).toBeUndefined();
    expect(rows[0]).toEqual({
      userId: "u-1",
      firstName: "Ada",
      lastName: "Lovelace",
      role: "WAITER",
      last4: "2B9C",
      assignedAt: new Date("2026-08-20T10:00:00Z"),
      assignedById: "u-admin",
    });
  });
});
