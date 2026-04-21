/**
 * Normalize an HTTP list-endpoint payload into an array.
 *
 * Backends in this project currently return two shapes depending on
 * endpoint vintage:
 *   1. Bare array: `[...]`
 *   2. Envelope: `{ data: [...], meta: {...} }` (the newer paginated shape)
 *
 * Either shape is accepted, and any other shape — including `null`,
 * `undefined`, or an error body that slipped past the axios `throw` —
 * collapses to `[]`. Consumers can then call `.filter`, `.map`, etc.
 * without a defensive `Array.isArray(...)` check on every access.
 *
 * This helper exists because a drift between a list endpoint's old and
 * new return shapes previously crashed the admin users page with
 * `TypeError: n.filter is not a function` inside a useMemo.
 */
export function toArrayPayload<T = unknown>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const envelope = (payload as { data?: unknown }).data;
    if (Array.isArray(envelope)) return envelope as T[];
  }
  return [];
}
