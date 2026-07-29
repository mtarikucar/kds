import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Specs for the C1 customer-session rail: the frontend NEVER invents a
 * session id — it mints one from POST /customer-public/sessions, persists it
 * in the cart store, and transparently re-mints + retries once on 401.
 */

const post = vi.fn();
vi.mock('axios', () => ({
  default: { post: (...a: unknown[]) => post(...a) },
}));

import {
  ensureCustomerSession,
  remintCustomerSession,
  retryWith401Remint,
  withCustomerSession,
  remintCustomerSessionOn401,
} from './customerSession';
import { useCartStore } from '../../store/cartStore';

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

const mintResponse = (sessionId: string) => ({
  data: { sessionId, expiresAt: new Date(Date.now() + 4 * 3_600_000).toISOString() },
});

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.setState({
    items: [],
    sessionId: null,
    sessionExpiresAt: null,
    tenantId: 't-1',
    tableId: null,
    currency: 'TRY',
  });
  localStorage.clear();
});

describe('ensureCustomerSession — minting', () => {
  it('mints a server session with { tenantId } and persists id + expiry', async () => {
    post.mockResolvedValue(mintResponse(HEX_A));
    const sid = await ensureCustomerSession();

    expect(sid).toBe(HEX_A);
    expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/customer-public/sessions'),
      { tenantId: 't-1' },
    );
    const s = useCartStore.getState();
    expect(s.sessionId).toBe(HEX_A);
    expect(s.sessionExpiresAt).toBeGreaterThan(Date.now());
  });

  it('includes tableId in the mint body when the cart is table-bound', async () => {
    useCartStore.setState({ tableId: 'table-9' });
    post.mockResolvedValue(mintResponse(HEX_A));
    await ensureCustomerSession();
    expect(post).toHaveBeenCalledWith(expect.any(String), {
      tenantId: 't-1',
      tableId: 'table-9',
    });
  });

  it('returns the stored server session without re-minting when still valid', async () => {
    useCartStore.setState({
      sessionId: HEX_A,
      sessionExpiresAt: Date.now() + 3_600_000,
    });
    const sid = await ensureCustomerSession();
    expect(sid).toBe(HEX_A);
    expect(post).not.toHaveBeenCalled();
  });

  it('re-mints when the stored session is expired', async () => {
    useCartStore.setState({
      sessionId: HEX_A,
      sessionExpiresAt: Date.now() - 1000,
    });
    post.mockResolvedValue(mintResponse(HEX_B));
    const sid = await ensureCustomerSession();
    expect(sid).toBe(HEX_B);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('never treats a legacy UUID as a session — it mints a real one', async () => {
    // A pre-C1 UUID can only reach state via direct set (migration nukes the
    // persisted one); ensure must refuse to hand it to any caller.
    useCartStore.setState({
      sessionId: '0198c7a2-1111-4222-8333-444455556666' as never,
      sessionExpiresAt: null,
    });
    post.mockResolvedValue(mintResponse(HEX_A));
    const sid = await ensureCustomerSession();
    expect(sid).toBe(HEX_A);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent mints (one POST for parallel callers)', async () => {
    post.mockResolvedValue(mintResponse(HEX_A));
    const [a, b] = await Promise.all([
      ensureCustomerSession(),
      ensureCustomerSession(),
    ]);
    expect(a).toBe(HEX_A);
    expect(b).toBe(HEX_A);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects when no tenant is bound yet (menu not loaded)', async () => {
    useCartStore.setState({ tenantId: null });
    await expect(ensureCustomerSession()).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a malformed mint response instead of storing it', async () => {
    post.mockResolvedValue({ data: { sessionId: 'not-hex' } });
    await expect(ensureCustomerSession()).rejects.toThrow();
    expect(useCartStore.getState().sessionId).toBeNull();
  });
});

describe('retryWith401Remint / withCustomerSession — transparent re-mint', () => {
  it('re-mints once and retries the request on 401', async () => {
    post.mockResolvedValue(mintResponse(HEX_B));
    const attempt = vi
      .fn()
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce('ok');

    const result = await retryWith401Remint(attempt, HEX_A);

    expect(result).toBe('ok');
    expect(attempt).toHaveBeenNthCalledWith(1, HEX_A);
    expect(attempt).toHaveBeenNthCalledWith(2, HEX_B);
    expect(useCartStore.getState().sessionId).toBe(HEX_B);
  });

  it('does NOT re-mint on non-401 errors (e.g. validation 400)', async () => {
    const err = { response: { status: 400 } };
    const attempt = vi.fn().mockRejectedValue(err);
    await expect(retryWith401Remint(attempt, HEX_A)).rejects.toBe(err);
    expect(post).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('withCustomerSession ensures first, then runs the attempt with the minted id', async () => {
    post.mockResolvedValue(mintResponse(HEX_A));
    const attempt = vi.fn().mockResolvedValue('done');
    const result = await withCustomerSession(attempt);
    expect(result).toBe('done');
    expect(attempt).toHaveBeenCalledWith(HEX_A);
  });
});

describe('remintCustomerSession / remintCustomerSessionOn401', () => {
  it('remint drops the stored session and mints a fresh one', async () => {
    useCartStore.setState({
      sessionId: HEX_A,
      sessionExpiresAt: Date.now() + 3_600_000,
    });
    post.mockResolvedValue(mintResponse(HEX_B));
    const sid = await remintCustomerSession();
    expect(sid).toBe(HEX_B);
    expect(useCartStore.getState().sessionId).toBe(HEX_B);
  });

  it('remintOn401 fires only for 401 errors', async () => {
    post.mockResolvedValue(mintResponse(HEX_B));
    remintCustomerSessionOn401({ response: { status: 500 } });
    remintCustomerSessionOn401(new Error('network'));
    expect(post).not.toHaveBeenCalled();

    remintCustomerSessionOn401({ response: { status: 401 } });
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });
});
