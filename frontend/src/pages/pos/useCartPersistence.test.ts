import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  buildCartStorageKey,
  readPersistedCart,
  writePersistedCart,
  useCartPersistence,
  CART_TTL_MS,
  LEGACY_CART_KEY,
} from './useCartPersistence';
import { useAuthStore } from '../../store/authStore';
import type { User } from '../../types';

interface Item {
  id: string;
  quantity: number;
}

const KEY = 'pos_cart::tenant-1::user-1';

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ user: null, isAuthenticated: false, accessToken: null });
});

describe('buildCartStorageKey', () => {
  it('produces pos_cart::<tenantId>::<userId> for a logged-in user', () => {
    expect(buildCartStorageKey({ tenantId: 'tenant-1', id: 'user-1' })).toBe(KEY);
  });

  it('returns null when there is no user (persistence disabled)', () => {
    expect(buildCartStorageKey(null)).toBeNull();
    expect(buildCartStorageKey(undefined)).toBeNull();
  });

  it('scopes the key per user so two users never collide', () => {
    const a = buildCartStorageKey({ tenantId: 't', id: 'u-a' });
    const b = buildCartStorageKey({ tenantId: 't', id: 'u-b' });
    expect(a).not.toBe(b);
  });
});

describe('readPersistedCart', () => {
  it('returns [] and writes nothing when key is null', () => {
    expect(readPersistedCart<Item>(null)).toEqual([]);
  });

  it('returns [] when there is no saved entry', () => {
    expect(readPersistedCart<Item>(KEY)).toEqual([]);
  });

  it('reads a valid, non-expired persisted cart', () => {
    const now = 1_000_000;
    const items: Item[] = [{ id: 'p1', quantity: 2 }];
    localStorage.setItem(KEY, JSON.stringify({ items, savedAt: now }));
    expect(readPersistedCart<Item>(KEY, now + CART_TTL_MS - 1)).toEqual(items);
  });

  it('drops and clears a cart older than the 12h TTL', () => {
    const now = 1_000_000;
    localStorage.setItem(
      KEY,
      JSON.stringify({ items: [{ id: 'p1', quantity: 1 }], savedAt: now }),
    );
    // 1ms past the TTL boundary
    expect(readPersistedCart<Item>(KEY, now + CART_TTL_MS + 1)).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps a cart exactly at the TTL boundary (not strictly greater)', () => {
    const now = 1_000_000;
    const items: Item[] = [{ id: 'p1', quantity: 1 }];
    localStorage.setItem(KEY, JSON.stringify({ items, savedAt: now }));
    // age === CART_TTL_MS is NOT > CART_TTL_MS, so it is retained
    expect(readPersistedCart<Item>(KEY, now + CART_TTL_MS)).toEqual(items);
  });

  it('treats a bare-array (no savedAt) legacy persistence as expired and clears it', () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 'p1', quantity: 1 }]));
    expect(readPersistedCart<Item>(KEY, 123)).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('treats a malformed envelope (items not array) as expired and clears it', () => {
    localStorage.setItem(KEY, JSON.stringify({ items: 'nope', savedAt: 1 }));
    expect(readPersistedCart<Item>(KEY, 123)).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('returns [] on malformed JSON without throwing', () => {
    localStorage.setItem(KEY, '{not json');
    expect(readPersistedCart<Item>(KEY, 123)).toEqual([]);
  });

  it('always removes the legacy bare pos_cart key as a one-time migration', () => {
    localStorage.setItem(LEGACY_CART_KEY, JSON.stringify([{ id: 'old', quantity: 9 }]));
    readPersistedCart<Item>(KEY, 123);
    expect(localStorage.getItem(LEGACY_CART_KEY)).toBeNull();
  });
});

describe('writePersistedCart', () => {
  it('persists items under the key with the supplied timestamp', () => {
    const items: Item[] = [{ id: 'p1', quantity: 3 }];
    writePersistedCart(KEY, items, 555);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ items, savedAt: 555 });
  });

  it('is a no-op when key is null', () => {
    const before = localStorage.length;
    writePersistedCart(null, [{ id: 'p1', quantity: 1 }], 1);
    // Nothing new written (auth-store persist may have left its own key).
    expect(localStorage.length).toBe(before);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('round-trips with readPersistedCart', () => {
    const now = 2_000_000;
    const items: Item[] = [{ id: 'a', quantity: 1 }, { id: 'b', quantity: 4 }];
    writePersistedCart(KEY, items, now);
    expect(readPersistedCart<Item>(KEY, now)).toEqual(items);
  });

  it('swallows storage failures silently (private mode / quota)', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
    expect(() => writePersistedCart(KEY, [{ id: 'p', quantity: 1 }], 1)).not.toThrow();
    spy.mockRestore();
  });
});

const fakeUser = (tenantId: string, id: string): User =>
  ({ tenantId, id } as User);

describe('useCartPersistence hook', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the per-user storage key derived from the auth store', () => {
    useAuthStore.setState({ user: fakeUser('tenant-1', 'user-1') });
    const { result } = renderHook(() => useCartPersistence<Item>());
    expect(result.current.cartStorageKey).toBe(KEY);
  });

  it('returns a null key (no persistence) when logged out', () => {
    useAuthStore.setState({ user: null });
    const { result } = renderHook(() => useCartPersistence<Item>());
    expect(result.current.cartStorageKey).toBeNull();
  });

  it('hydrates initial items from a valid persisted cart', () => {
    const items: Item[] = [{ id: 'p1', quantity: 2 }];
    localStorage.setItem(KEY, JSON.stringify({ items, savedAt: Date.now() }));
    useAuthStore.setState({ user: fakeUser('tenant-1', 'user-1') });

    const { result } = renderHook(() => useCartPersistence<Item>());
    expect(result.current.cartItems).toEqual(items);
  });

  it('write-through-persists cart updates under the active key', () => {
    useAuthStore.setState({ user: fakeUser('tenant-1', 'user-1') });
    const { result } = renderHook(() => useCartPersistence<Item>());

    act(() => {
      result.current.setCartItems([{ id: 'new', quantity: 7 }]);
    });

    const persisted = JSON.parse(localStorage.getItem(KEY)!);
    expect(persisted.items).toEqual([{ id: 'new', quantity: 7 }]);
    expect(typeof persisted.savedAt).toBe('number');
  });
});
