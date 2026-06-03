import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time HMAC-hex comparison used by every signed-webhook adapter.
 *
 * Why a shared helper: each adapter was rolling its own length check, and
 * the obvious version (`a.length !== b.length`) is correct only when both
 * strings are guaranteed hex. A receiver sending raw-bytes-as-utf8 (or a
 * truncated hex string) can dodge the string-length gate and still pass
 * `Buffer.from(...)` parsing into mismatched-byte-length buffers — which
 * `timingSafeEqual` then throws on, but the throw is what we use to
 * signal "invalid", so we want a clear, single path.
 *
 * This helper:
 *   1. Rejects non-hex signatures up front (so `Buffer.from(..., 'hex')`
 *      doesn't silently drop invalid bytes).
 *   2. Compares as Buffers with byte-length equality.
 *   3. Falls back to a constant-time mismatch when sizes differ, so an
 *      attacker can't time-probe the length.
 *
 * Returns true iff the signatures match. Throws are reserved for
 * configuration errors (missing secret) — adapters handle the boolean
 * result themselves.
 */
export function verifyHmacHex(
  expectedHex: string,
  providedHex: string,
): boolean {
  // Strip any "sha256=" prefix some providers wrap around the hex.
  const provided = providedHex
    .replace(/^sha256=/i, "")
    .trim()
    .toLowerCase();
  const expected = expectedHex.trim().toLowerCase();

  // Hex sanity: every char must be 0-9a-f and the length must be even.
  if (!/^[0-9a-f]+$/.test(provided) || provided.length % 2 !== 0) {
    return false;
  }
  if (provided.length !== expected.length) {
    // Constant-time mismatch: spend roughly the same time as a real
    // compare so the rejection path doesn't leak length info.
    const a = Buffer.from(expected, "hex");
    const b = Buffer.alloc(a.byteLength); // zero buffer of same size
    try {
      timingSafeEqual(a, b);
    } catch {
      /* swallow */
    }
    return false;
  }

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}
