import {
  STATUS_TO_PLATFORM_ACTION,
  SYNCABLE_STATUSES,
  POLLING_PLATFORMS,
  PLATFORM_POLL_INTERVALS,
  CIRCUIT_BREAKER_THRESHOLD,
} from "./platform-status-map";
import { OrderStatus } from "../../../common/constants/order-status.enum";

/**
 * Long-tail spec for the delivery status-sync mapping. Load-bearing
 * contracts: only PENDING/PREPARING/READY/CANCELLED sync back to the
 * platform (SERVED is a dine-in concept and must NOT map to "picked up");
 * the action map and syncable set agree; polling platforms have a minimum
 * interval; and the breaker threshold is a positive integer.
 */
describe("platform-status-map", () => {
  it("maps each syncable KDS status to its platform adapter method", () => {
    expect(STATUS_TO_PLATFORM_ACTION[OrderStatus.PENDING]).toBe("acceptOrder");
    expect(STATUS_TO_PLATFORM_ACTION[OrderStatus.PREPARING]).toBe(
      "markPreparing",
    );
    expect(STATUS_TO_PLATFORM_ACTION[OrderStatus.READY]).toBe("markReady");
    expect(STATUS_TO_PLATFORM_ACTION[OrderStatus.CANCELLED]).toBe(
      "cancelOrder",
    );
  });

  it("does NOT map SERVED (dine-in concept, not a courier pickup)", () => {
    expect(STATUS_TO_PLATFORM_ACTION[OrderStatus.SERVED]).toBeUndefined();
    expect(SYNCABLE_STATUSES.has(OrderStatus.SERVED)).toBe(false);
  });

  it("keeps the action map and syncable set in agreement", () => {
    for (const status of Object.keys(STATUS_TO_PLATFORM_ACTION)) {
      expect(SYNCABLE_STATUSES.has(status as OrderStatus)).toBe(true);
    }
  });

  it("defines a minimum poll interval for every polling platform", () => {
    for (const p of POLLING_PLATFORMS) {
      expect(PLATFORM_POLL_INTERVALS[p]).toBeGreaterThan(0);
    }
  });

  it("trips the circuit breaker after a positive number of errors", () => {
    expect(CIRCUIT_BREAKER_THRESHOLD).toBeGreaterThan(0);
    expect(Number.isInteger(CIRCUIT_BREAKER_THRESHOLD)).toBe(true);
  });
});
