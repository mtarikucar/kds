/**
 * Pure logic extracted from PairingScreen for unit testing. Behavior is
 * byte-identical to the inlined original (`pairCode.trim().toUpperCase()`);
 * PairingScreen re-imports and calls it at the same submit-time call site.
 */

/**
 * Normalize an operator-entered pair code before it is sent to the server:
 * strip surrounding whitespace and upper-case it. Pair codes are
 * case-insensitive 6-char alphanumerics; this guarantees the wire value
 * matches regardless of stray spaces or lower-case typing.
 */
export function normalizePairCode(raw: string): string {
  return raw.trim().toUpperCase();
}
