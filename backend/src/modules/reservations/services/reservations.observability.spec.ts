const mockCapture = jest.fn();
jest.mock("../../../sentry.config", () => ({
  captureException: (...args: unknown[]) => mockCapture(...args),
}));

import { ReservationsService } from "./reservations.service";

/**
 * The customer notify is fire-and-forget by design, but a send failure must
 * not vanish: it is counted and surfaced to Sentry (the audit flagged these
 * unawaited notify() calls as silently dropping failures).
 */
function build(notifyImpl: jest.Mock) {
  const metrics = { incCounter: jest.fn() };
  const svc = new ReservationsService(
    {} as any, // prisma
    {} as any, // notificationsService
    {} as any, // settingsService
    { notify: notifyImpl } as any, // reservationNotificationService
    metrics as any,
  );
  return { svc, metrics };
}

describe("ReservationsService notify observability", () => {
  beforeEach(() => mockCapture.mockClear());

  it("counts the reservation event and does not alert when notify succeeds", async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const { svc, metrics } = build(notify);

    (svc as any).notifyCustomer("t-1", "created", {});
    await new Promise((r) => setImmediate(r));

    expect(metrics.incCounter).toHaveBeenCalledWith(
      "reservations_total",
      expect.any(String),
      { status: "created" },
    );
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("captures a notify failure to Sentry without throwing", async () => {
    const notify = jest.fn().mockRejectedValue(new Error("smtp down"));
    const { svc } = build(notify);

    expect(() => (svc as any).notifyCustomer("t-1", "confirmed", {})).not.toThrow();
    await new Promise((r) => setImmediate(r));

    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ event: "confirmed", tenantId: "t-1" }),
    );
  });
});
