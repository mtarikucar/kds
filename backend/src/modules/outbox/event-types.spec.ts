import {
  EventTypes,
  KNOWN_EVENT_TYPES,
  isKnownEventType,
} from "./event-types";

/**
 * Long-tail spec for the outbox event-type registry + recogniser. Load-
 * bearing contracts: every registered event name carries the documented
 * `.vN` schema-version suffix; KNOWN_EVENT_TYPES mirrors the EventTypes
 * values; and isKnownEventType accepts both registered names AND the
 * dynamically-named families (integration.webhook.*, marketing.*) so the
 * unregistered-type warning doesn't fire for legitimate runtime events —
 * while still rejecting an actual typo.
 */
describe("event-types", () => {
  it("every registered event name carries a .vN version suffix", () => {
    for (const name of Object.values(EventTypes)) {
      expect(name).toMatch(/\.v\d+$/);
    }
  });

  it("KNOWN_EVENT_TYPES mirrors the EventTypes values", () => {
    for (const name of Object.values(EventTypes)) {
      expect(KNOWN_EVENT_TYPES.has(name)).toBe(true);
    }
  });

  it("isKnownEventType accepts a registered event", () => {
    expect(isKnownEventType(EventTypes.OrderCreated)).toBe(true);
  });

  it("isKnownEventType accepts dynamically-named families by prefix", () => {
    expect(
      isKnownEventType("integration.webhook.getir.received.v1"),
    ).toBe(true);
    expect(isKnownEventType("marketing.lead.created.v1")).toBe(true);
  });

  it("isKnownEventType rejects an actual typo / unregistered name", () => {
    expect(isKnownEventType("order.craeted.v1")).toBe(false);
    expect(isKnownEventType("totally.unknown")).toBe(false);
  });
});
