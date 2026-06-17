import { OutboxWorkerService } from "./outbox-worker.service";

/**
 * Drain-loop semantics around the Phase-5 marketing relay. The invariants
 * that matter (and bit us before):
 *
 *   1. A relayed row is marked dispatched.
 *   2. A marketing-bound row drained while MARKETING_SERVICE_URL is unset is
 *      PARKED — stays 'queued' with a long nextAttemptAt and the claim's
 *      attempt increment handed back — NOT marked dispatched (which used to
 *      let the pruner delete it: "paused" crediting was actually lossy) and
 *      NOT able to reach the DLQ from this path.
 *   3. A relay failure rides the normal retry/backoff/DLQ machinery.
 */
describe("OutboxWorkerService — drainOnce", () => {
  const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: "evt-1",
    type: "payment.succeeded.v1",
    tenantId: "t-1",
    payload: { paymentId: "p-1" },
    idempotencyKey: "payment-succeeded:p-1",
    attempts: 1, // post-claim value (the claim UPDATE increments it)
    createdAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  });

  let prisma: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    outboxEvent: { update: jest.Mock };
  };
  let bus: { dispatch: jest.Mock };
  let relay: {
    relay: jest.Mock;
    isMarketingBound: jest.Mock;
  };
  let worker: OutboxWorkerService;

  const drainOnce = () =>
    (worker as unknown as { drainOnce(): Promise<number> }).drainOnce();

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([row()]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      outboxEvent: { update: jest.fn().mockResolvedValue({}) },
    };
    bus = { dispatch: jest.fn().mockResolvedValue(undefined) };
    relay = {
      relay: jest.fn().mockResolvedValue("relayed"),
      isMarketingBound: jest.fn().mockReturnValue(true),
    };
    worker = new OutboxWorkerService(
      prisma as never,
      bus as never,
      relay as never,
    );
  });

  it("dispatches onto the bus, relays with the row's idempotencyKey/tenantId, then marks dispatched", async () => {
    await expect(drainOnce()).resolves.toBe(1);

    expect(bus.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evt-1",
        type: "payment.succeeded.v1",
        idempotencyKey: "payment-succeeded:p-1",
        tenantId: "t-1",
      }),
    );
    // The full drained row (incl. idempotencyKey + tenantId) goes to the
    // relay so the producer's dedup key survives the HTTP hop.
    expect(relay.relay).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "payment.succeeded.v1",
        idempotencyKey: "payment-succeeded:p-1",
        tenantId: "t-1",
      }),
    );
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-1" },
      data: expect.objectContaining({ status: "dispatched", lastError: null }),
    });
  });

  describe("parking (relay reports skipped-unconfigured)", () => {
    beforeEach(() => {
      relay.relay.mockResolvedValue("skipped-unconfigured");
    });

    it("leaves the row pending instead of marking it dispatched", async () => {
      await drainOnce();

      expect(prisma.outboxEvent.update).toHaveBeenCalledTimes(1);
      const { data } = prisma.outboxEvent.update.mock.calls[0][0];
      expect(data.status).toBe("queued");
      expect(data.dispatchedAt).toBeUndefined();
    });

    it("hands back the attempt the claim burned, so parking can never DLQ", async () => {
      prisma.$queryRaw.mockResolvedValue([row({ attempts: 8 })]); // at MAX_ATTEMPTS

      await drainOnce();

      const { data } = prisma.outboxEvent.update.mock.calls[0][0];
      expect(data.status).toBe("queued"); // not 'failed' even at the cap
      expect(data.attempts).toBe(7); // post-claim value minus 1 = pre-claim value
    });

    it("schedules the retry ~30 minutes out (long park, not the error backoff)", async () => {
      const before = Date.now();
      await drainOnce();
      const after = Date.now();

      const { data } = prisma.outboxEvent.update.mock.calls[0][0];
      const next = (data.nextAttemptAt as Date).getTime();
      expect(next).toBeGreaterThanOrEqual(before + 29 * 60_000);
      expect(next).toBeLessThanOrEqual(after + 31 * 60_000);
      expect(data.lastError).toMatch(/MARKETING_SERVICE_URL/);
    });

    it("still dispatches onto the local bus before parking (documented at-least-once)", async () => {
      await drainOnce();
      expect(bus.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  describe("relay failure (normal retry machinery)", () => {
    beforeEach(() => {
      relay.relay.mockRejectedValue(new Error("status 503"));
    });

    it("re-queues with backoff and keeps the attempt increment", async () => {
      await drainOnce();

      const { data } = prisma.outboxEvent.update.mock.calls[0][0];
      expect(data.status).toBe("queued");
      expect(data.attempts).toBeUndefined(); // claim's increment stands
      expect(data.lastError).toBe("status 503");
      expect(data.nextAttemptAt).toBeInstanceOf(Date);
    });

    it("DLQs (status failed) once attempts reach the cap", async () => {
      prisma.$queryRaw.mockResolvedValue([row({ attempts: 8 })]);

      await drainOnce();

      const { data } = prisma.outboxEvent.update.mock.calls[0][0];
      expect(data.status).toBe("failed");
      expect(data.nextAttemptAt).toBeNull();
    });
  });

  // deep-review H16: rows orphaned in 'dispatching' by a worker crash must be
  // reclaimed back to 'queued' so the events (payment.succeeded.v1 commission
  // crediting, entitlement reprojection, …) aren't lost forever.
  describe("reclaimStuck (worker-crash recovery)", () => {
    const reclaimStuck = () =>
      (worker as unknown as { reclaimStuck(): Promise<number> }).reclaimStuck();

    it("re-queues orphaned 'dispatching' rows aged past the timeout", async () => {
      // Simulate a crash: a prior tick claimed a batch (flipping rows to
      // 'dispatching') and died before the terminal write. The next tick's
      // reclaim pass runs the reaper UPDATE, which reports 2 affected rows.
      prisma.$executeRaw.mockResolvedValue(2);

      await expect(reclaimStuck()).resolves.toBe(2);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it("is a no-op when nothing is stuck (returns 0, no terminal writes)", async () => {
      prisma.$executeRaw.mockResolvedValue(0);

      await expect(reclaimStuck()).resolves.toBe(0);
      expect(prisma.outboxEvent.update).not.toHaveBeenCalled();
    });
  });
});
