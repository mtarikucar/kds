import { useEffect, useState } from 'react';
import { useAuthStore } from '../../store/authStore';

/**
 * POS cart localStorage persistence — TTL + per-user key scoping.
 *
 * Extracted verbatim from POSPage so the (bug-prone) TTL/key logic can be
 * unit-tested in isolation. Behavior is preserved exactly:
 *
 *  - Key shape `pos_cart::<tenantId>::<userId>` (v2.8.97) so a
 *    logout-then-different-login on the same device can't surface the prior
 *    user's stale cart. No user -> no key -> persistence disabled.
 *  - 12h TTL: a persisted cart older than CART_TTL_MS is dropped on read.
 *  - One-time legacy migration: the pre-v2.8.97 bare `pos_cart` key is
 *    removed on first read.
 *  - Backwards-compat: a bare-array persistence (no `savedAt` timestamp) is
 *    treated as expired and dropped — we can't know its age.
 *  - Storage failures (private mode / quota) are swallowed silently.
 */

/** 12 hours, unchanged since the original inline implementation. */
export const CART_TTL_MS = 12 * 60 * 60 * 1000;

/** Pre-v2.8.97 unscoped key, removed on every read as a one-time migration. */
export const LEGACY_CART_KEY = 'pos_cart';

/** Persisted envelope shape. */
interface PersistedCart<T> {
  items: T[];
  savedAt: number;
}

/**
 * Build the per-(tenant,user) storage key. Returns null when there is no
 * user (persistence is then disabled — the original returned `null` and the
 * read/write paths short-circuit on it).
 */
export function buildCartStorageKey(
  user: { tenantId: string | null; id: string } | null | undefined,
): string | null {
  // Matches the original inline `user ? ... : null`: only the user object's
  // presence gates persistence. A null tenantId interpolates as the literal
  // "null" segment, same as before — not changed here on purpose.
  return user ? `pos_cart::${user.tenantId}::${user.id}` : null;
}

/**
 * Read + validate a persisted cart for `key`. Performs the legacy-key
 * migration, shape validation, and TTL check; returns the items or [] and
 * removes the entry from storage when it is invalid/expired.
 *
 * `now` is injectable for deterministic TTL tests (defaults to Date.now()).
 */
export function readPersistedCart<T>(
  key: string | null,
  now: number = Date.now(),
): T[] {
  if (!key) return [];
  try {
    // One-time legacy migration: drop the pre-v2.8.97 unscoped key so an
    // upgraded build starts clean instead of cross-user surfacing.
    localStorage.removeItem(LEGACY_CART_KEY);
    const saved = localStorage.getItem(key);
    if (!saved) return [];
    const parsed = JSON.parse(saved) as PersistedCart<T> | unknown;
    // Backwards-compat: older runs persisted a bare array. Treat those as
    // expired (no timestamp = age unknown) so we don't carry over
    // arbitrarily-old carts on first upgrade.
    if (
      !parsed ||
      !Array.isArray((parsed as PersistedCart<T>).items) ||
      typeof (parsed as PersistedCart<T>).savedAt !== 'number'
    ) {
      localStorage.removeItem(key);
      return [];
    }
    const envelope = parsed as PersistedCart<T>;
    if (now - envelope.savedAt > CART_TTL_MS) {
      localStorage.removeItem(key);
      return [];
    }
    return envelope.items;
  } catch {
    return [];
  }
}

/**
 * Persist `items` under `key` with the current timestamp. No-op when key is
 * null. Swallows storage failures (private mode / quota exceeded).
 */
export function writePersistedCart<T>(
  key: string | null,
  items: T[],
  now: number = Date.now(),
): void {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({ items, savedAt: now }));
  } catch {
    // Storage unavailable (private mode, quota exceeded) — drop silently.
  }
}

/**
 * Hook owning the cart-items state with lazy TTL-checked read-through from
 * localStorage and a write-through persistence effect. Returns the same
 * tuple POSPage used inline plus the active storage key (so other reset
 * paths can clear it if ever needed — POSPage currently does not).
 */
export function useCartPersistence<T>(): {
  cartItems: T[];
  setCartItems: React.Dispatch<React.SetStateAction<T[]>>;
  cartStorageKey: string | null;
} {
  const user = useAuthStore((s) => s.user);
  const cartStorageKey = buildCartStorageKey(user);

  const [cartItems, setCartItems] = useState<T[]>(() =>
    readPersistedCart<T>(cartStorageKey),
  );

  useEffect(() => {
    writePersistedCart(cartStorageKey, cartItems);
  }, [cartItems, cartStorageKey]);

  return { cartItems, setCartItems, cartStorageKey };
}
