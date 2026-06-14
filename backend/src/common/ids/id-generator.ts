import { Injectable } from "@nestjs/common";
import { randomBytes, randomUUID } from "crypto";

/**
 * Injectable identifier / randomness abstraction.
 *
 * Like the wall clock, cryptographic randomness is an ambient collaborator:
 * code that calls `randomBytes()` / `randomUUID()` inline produces a different
 * value every run and cannot be asserted on. Injecting an {@link IdGenerator}
 * lets a unit test substitute a deterministic stub and lock down any
 * id-derived output (merchant OIDs, tokens, correlation ids).
 *
 * Production wires {@link SystemIdGenerator}, which delegates to Node's `crypto`
 * — so runtime behaviour is identical to inline usage.
 */
export interface IdGenerator {
  /** A v4 UUID string. Mirrors `crypto.randomUUID()`. */
  uuid(): string;
  /**
   * `bytes` cryptographically-random bytes rendered as lowercase hex
   * (so the returned string is `2 * bytes` characters long).
   * Mirrors `crypto.randomBytes(bytes).toString("hex")`.
   */
  randomHex(bytes: number): string;
}

/**
 * DI token for {@link IdGenerator}. Inject with `@Inject(ID_GENERATOR)`.
 *
 * A Symbol (not the interface) is used as the token because interfaces are
 * erased at runtime and cannot be used for Nest provider resolution.
 */
export const ID_GENERATOR = Symbol("ID_GENERATOR");

/**
 * Default {@link IdGenerator} backed by Node's `crypto`. Behaviour is
 * byte-identical to calling `randomUUID()` / `randomBytes(n).toString("hex")`
 * inline.
 */
@Injectable()
export class SystemIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }

  randomHex(bytes: number): string {
    return randomBytes(bytes).toString("hex");
  }
}
