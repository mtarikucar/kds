import { DomainEventBus, DomainEvent } from "./domain-event-bus.service";

/**
 * The DomainEventBus contract is small but load-bearing for outbox
 * reliability:
 *   - listeners run in registration order, awaited sequentially;
 *   - a thrown handler is ISOLATED (logged, never rethrown) so it cannot
 *     abort the loop nor bubble to the outbox worker (which would bump
 *     attempts and re-dispatch → double projection);
 *   - wildcard `*` listeners observe every event AFTER the type-specific
 *     ones;
 *   - off() detaches; onModuleDestroy() clears everything.
 * Each assertion below fails if that behaviour regresses.
 */

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: "evt-1",
    type: "order.created.v1",
    tenantId: "tenant-1",
    payload: { foo: "bar" },
    idempotencyKey: "evt-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("DomainEventBus", () => {
  let bus: DomainEventBus;

  beforeEach(() => {
    bus = new DomainEventBus();
    // Silence the intentional error-log on the isolation path.
    jest
      .spyOn((bus as any).logger, "error")
      .mockImplementation(() => undefined);
  });

  it("delivers an event only to listeners registered for its type", async () => {
    const onCreated = jest.fn();
    const onUpdated = jest.fn();
    bus.on("order.created.v1", onCreated);
    bus.on("order.updated.v1", onUpdated);

    const event = makeEvent();
    await bus.dispatch(event);

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(event);
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("awaits async handlers in registration order", async () => {
    const order: string[] = [];
    bus.on("order.created.v1", async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push("first");
    });
    bus.on("order.created.v1", async () => {
      order.push("second");
    });

    await bus.dispatch(makeEvent());

    // Sequential await means the slow first handler still completes before
    // the second runs.
    expect(order).toEqual(["first", "second"]);
  });

  it("isolates a throwing listener: later listeners still run, dispatch resolves", async () => {
    const calls: string[] = [];
    bus.on("order.created.v1", () => {
      calls.push("a");
      throw new Error("boom");
    });
    bus.on("order.created.v1", () => {
      calls.push("b");
    });

    await expect(bus.dispatch(makeEvent())).resolves.toBeUndefined();
    expect(calls).toEqual(["a", "b"]);
    // The error path is logged (proving isolation went through the catch).
    expect((bus as any).logger.error).toHaveBeenCalledTimes(1);
  });

  it("isolates a rejecting async listener the same way as a sync throw", async () => {
    const after = jest.fn();
    bus.on("x.v1", async () => {
      throw new Error("async boom");
    });
    bus.on("x.v1", after);

    await expect(bus.dispatch(makeEvent({ type: "x.v1" }))).resolves.toBe(
      undefined,
    );
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("invokes wildcard (onAny) listeners for every event, after the type-specific ones", async () => {
    const seq: string[] = [];
    bus.on("order.created.v1", () => seq.push("typed"));
    bus.onAny(() => seq.push("wildcard"));

    await bus.dispatch(makeEvent());
    await bus.dispatch(makeEvent({ type: "unrelated.v1" }));

    // typed listener fires once (only the matching event); wildcard twice.
    // Within the first dispatch, typed precedes wildcard.
    expect(seq).toEqual(["typed", "wildcard", "wildcard"]);
  });

  it("off() detaches a listener so it no longer receives events", async () => {
    const handler = jest.fn();
    bus.on("order.created.v1", handler);
    bus.off("order.created.v1", handler);

    await bus.dispatch(makeEvent());
    expect(handler).not.toHaveBeenCalled();
  });

  it("onModuleDestroy removes all listeners", async () => {
    const typed = jest.fn();
    const wildcard = jest.fn();
    bus.on("order.created.v1", typed);
    bus.onAny(wildcard);

    bus.onModuleDestroy();
    await bus.dispatch(makeEvent());

    expect(typed).not.toHaveBeenCalled();
    expect(wildcard).not.toHaveBeenCalled();
  });

  it("dispatch with no listeners resolves without error", async () => {
    await expect(bus.dispatch(makeEvent())).resolves.toBeUndefined();
  });
});
