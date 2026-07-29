import axios from 'axios';
import { API_URL } from '../../lib/env';
import { useCartStore, SERVER_SESSION_ID_REGEX } from '../../store/cartStore';

/**
 * Review C1 — the customer-session rail for the public QR menu.
 *
 * The backend only accepts SERVER-MINTED session tokens (32 random bytes as
 * 64 lower-hex chars, POST /customer-public/sessions → { sessionId,
 * expiresAt }, backed by a CustomerSession row). The frontend used to invent
 * a crypto.randomUUID() locally, which every session-bound endpoint rejected:
 * order submit 400'd, waiter/bill 400'd, tracking/self-pay/loyalty 401'd.
 *
 * This module is the ONE mint mechanism:
 *  - `ensureCustomerSession()` returns the stored server session when it is
 *    still valid, otherwise mints a new one (single-flight) and persists it
 *    in the cart store. QRMenuLayout calls it on menu load; action rails call
 *    it on demand.
 *  - `retryWith401Remint(fn, sessionId)` runs a session-bound request and, on
 *    a 401 (expired/invalid server session), transparently re-mints once and
 *    retries with the fresh token.
 *  - `withCustomerSession(fn)` = ensure + retryWith401Remint — for callers
 *    that may run before the bootstrap mint resolved (e.g. order submit).
 *  - `remintCustomerSessionOn401(err)` — fire-and-forget self-heal for read
 *    rails (order polling, loyalty, payable-items): the store update fans out
 *    to every subscriber, which re-fetches with the fresh id.
 *
 * FH5 invariant: the session id is a bearer credential. It is NEVER read
 * from the URL and never emitted into one — the only source is this module's
 * server mint, persisted per-device in the cart store.
 */

const EXPIRY_MARGIN_MS = 60_000;

let mintInflight: Promise<string> | null = null;
let mintInflightKey: string | null = null;

const sessionAuthStatus = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } } | undefined)?.response?.status;

export const isSessionAuthError = (err: unknown): boolean =>
  sessionAuthStatus(err) === 401;

function currentValidSession(): string | null {
  const { sessionId, sessionExpiresAt } = useCartStore.getState();
  if (!sessionId || !SERVER_SESSION_ID_REGEX.test(sessionId)) return null;
  if (sessionExpiresAt && Date.now() >= sessionExpiresAt - EXPIRY_MARGIN_MS) {
    return null;
  }
  return sessionId;
}

function mintSession(): Promise<string> {
  const { tenantId, tableId } = useCartStore.getState();
  if (!tenantId) {
    return Promise.reject(
      new Error('customerSession: no tenant bound yet — cannot mint'),
    );
  }
  const key = `${tenantId}|${tableId ?? ''}`;
  // Single-flight per tenant/table: menu load + an eager action must not
  // race two mints (the endpoint is throttled at 20/min/IP).
  if (mintInflight && mintInflightKey === key) return mintInflight;
  mintInflightKey = key;
  mintInflight = (async () => {
    try {
      const response = await axios.post(`${API_URL}/customer-public/sessions`, {
        tenantId,
        ...(tableId ? { tableId } : {}),
      });
      const sessionId: unknown = response.data?.sessionId;
      const expiresAt: string | null = response.data?.expiresAt ?? null;
      if (
        typeof sessionId !== 'string' ||
        !SERVER_SESSION_ID_REGEX.test(sessionId)
      ) {
        throw new Error('customerSession: malformed mint response');
      }
      useCartStore.getState().setServerSession(sessionId, expiresAt);
      return sessionId;
    } finally {
      mintInflight = null;
      mintInflightKey = null;
    }
  })();
  return mintInflight;
}

/** Valid stored server session, or mint a fresh one (single-flight). */
export function ensureCustomerSession(): Promise<string> {
  const existing = currentValidSession();
  return existing ? Promise.resolve(existing) : mintSession();
}

/** Drop the stored session and mint a brand-new one. */
export function remintCustomerSession(): Promise<string> {
  useCartStore.getState().clearServerSession();
  return mintSession();
}

/**
 * Run a session-bound request; on 401 (server rejected/expired the session)
 * re-mint once and retry with the fresh token. Safe for the POST rails too:
 * the backend resolves the session BEFORE creating anything, so a 401 means
 * nothing was written.
 */
export async function retryWith401Remint<T>(
  attempt: (sessionId: string) => Promise<T>,
  sessionId: string,
): Promise<T> {
  try {
    return await attempt(sessionId);
  } catch (err) {
    if (!isSessionAuthError(err)) throw err;
    const fresh = await remintCustomerSession();
    return attempt(fresh);
  }
}

/** ensure + retry-once-on-401 — for callers that can't assume a mint ran. */
export async function withCustomerSession<T>(
  attempt: (sessionId: string) => Promise<T>,
): Promise<T> {
  const sessionId = await ensureCustomerSession();
  return retryWith401Remint(attempt, sessionId);
}

/**
 * Fire-and-forget self-heal for polling/read rails: when a request died with
 * 401, re-mint in the background. The store update propagates the fresh id
 * to every subscriber (pages re-fetch with it on the next tick).
 */
export function remintCustomerSessionOn401(err: unknown): void {
  if (isSessionAuthError(err)) {
    remintCustomerSession().catch(() => {});
  }
}
