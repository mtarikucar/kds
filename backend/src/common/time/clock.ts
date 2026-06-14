import { Injectable } from "@nestjs/common";

/**
 * Injectable wall-clock abstraction.
 *
 * Time is an ambient collaborator: any code that calls `Date.now()` or
 * `new Date()` directly is non-deterministic and therefore awkward to test.
 * Injecting a {@link Clock} lets a unit test pin "now" to a fixed instant and
 * assert on time-derived values (timestamps, TTLs, OIDs) byte-for-byte.
 *
 * Production wires {@link SystemClock}, which simply delegates to the real
 * platform clock — so runtime behaviour is identical to inline `Date` usage.
 */
export interface Clock {
  /** Current instant as a `Date`. Mirrors `new Date()`. */
  now(): Date;
  /** Current instant in epoch milliseconds. Mirrors `Date.now()`. */
  nowMs(): number;
}

/**
 * DI token for {@link Clock}. Inject with `@Inject(CLOCK)`.
 *
 * A Symbol (not the interface) is used as the token because interfaces are
 * erased at runtime and cannot be used for Nest provider resolution.
 */
export const CLOCK = Symbol("CLOCK");

/**
 * Default {@link Clock} backed by the real platform clock. Behaviour is
 * byte-identical to calling `new Date()` / `Date.now()` inline.
 */
@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }
}
