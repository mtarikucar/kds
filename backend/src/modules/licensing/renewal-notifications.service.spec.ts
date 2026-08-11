import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { EventTypes } from "../outbox/event-types";
import { RenewalNotificationsService } from "./renewal-notifications.service";

/**
 * The half of the reminder that actually reaches a customer.
 *
 * The scheduler emits RenewalReminder and the outbox delivers it, but for a
 * while nothing subscribed: reminders were "sent" 30, 7 and 1 days out and
 * never left the building, so the first a tenant heard of their renewal was
 * losing access to a module. These tests exist so that gap cannot reopen.
 */
describe("RenewalNotificationsService", () => {
  let prisma: MockPrismaClient;
  let bus: { on: jest.Mock; handlers: Map<string, any> };
  let notifications: { sendRenewalReminder: jest.Mock };
  let svc: RenewalNotificationsService;

  const PAYLOAD = {
    tenantId: "t-1",
    renewalCycleId: "rc-1",
    anniversaryAt: "2027-03-10T00:00:00.000Z",
    daysLeft: 7,
    totalCents: 409_000,
    currency: "TRY",
  };

  const fire = (payload: unknown = PAYLOAD) =>
    bus.handlers.get(EventTypes.RenewalReminder)({ id: "evt-1", payload });

  beforeEach(() => {
    prisma = mockPrismaClient();
    const handlers = new Map<string, any>();
    bus = {
      handlers,
      on: jest.fn((type: string, fn: any) => handlers.set(type, fn)),
    };
    notifications = { sendRenewalReminder: jest.fn().mockResolvedValue(undefined) };
    svc = new RenewalNotificationsService(
      bus as any,
      prisma as any,
      notifications as any,
    );
    svc.onModuleInit();

    (prisma.tenant.findUnique as any).mockResolvedValue({
      name: "Kadıköy Restoran",
      reportEmails: ["ops@example.com"],
    });
    (prisma.user.findFirst as any).mockResolvedValue({
      email: "owner@example.com",
    });
  });

  it("subscribes to RenewalReminder on init", () => {
    expect(bus.on).toHaveBeenCalledWith(
      EventTypes.RenewalReminder,
      expect.any(Function),
    );
  });

  it("emails the account owner with the frozen total and a deep link", async () => {
    await fire();
    expect(notifications.sendRenewalReminder).toHaveBeenCalledWith(
      "owner@example.com",
      expect.objectContaining({
        tenantName: "Kadıköy Restoran",
        daysLeft: 7,
        totalCents: 409_000,
        renewalCycleId: "rc-1",
      }),
    );
  });

  it("falls back to the ops list when there is no active admin", async () => {
    // A bill must not go undelivered because the admin row was soft-deleted.
    (prisma.user.findFirst as any).mockResolvedValue(null);
    await fire();
    expect(notifications.sendRenewalReminder).toHaveBeenCalledWith(
      "ops@example.com",
      expect.anything(),
    );
  });

  it("skips quietly when there is no recipient at all", async () => {
    (prisma.user.findFirst as any).mockResolvedValue(null);
    (prisma.tenant.findUnique as any).mockResolvedValue({
      name: "X",
      reportEmails: [],
    });
    await expect(fire()).resolves.toBeUndefined();
    expect(notifications.sendRenewalReminder).not.toHaveBeenCalled();
  });

  it("does not bubble an SMTP failure back to the outbox worker", async () => {
    // Throwing here would feedback-loop the worker; the contract is
    // log-and-swallow.
    notifications.sendRenewalReminder.mockRejectedValue(new Error("smtp down"));
    await expect(fire()).resolves.toBeUndefined();
  });

  it("ignores a malformed event rather than throwing", async () => {
    await expect(fire({ tenantId: "t-1" })).resolves.toBeUndefined();
    expect(notifications.sendRenewalReminder).not.toHaveBeenCalled();
  });

  it("only mails an ACTIVE admin", async () => {
    await fire();
    expect((prisma.user.findFirst as any).mock.calls[0][0].where).toMatchObject({
      tenantId: "t-1",
      role: "ADMIN",
      status: "ACTIVE",
    });
  });
});
