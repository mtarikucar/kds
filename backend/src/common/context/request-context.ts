import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

/**
 * Request-scoped correlation context.
 *
 * Before this, a `requestId` lived only on the Express `req` object and the
 * HTTP access log — deeper service-layer logs, Sentry events, and outbox
 * appends had no way to reach it, so a single failed request couldn't be
 * traced across layers. This AsyncLocalStorage store is seeded once per
 * request (RequestContextMiddleware) and read from anywhere in the async
 * continuation — service code, the Winston LoggerService, and Sentry's
 * beforeSend — without threading an argument through every call.
 *
 * `tenantId`/`branchId`/`userId` are enriched after the guard chain resolves
 * them (RequestContextInterceptor), so logs emitted mid-handler carry the
 * full multi-tenant context for free.
 */
export interface RequestContextStore {
  requestId: string;
  tenantId?: string;
  branchId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  /**
   * Run `fn` inside a fresh context. A `requestId` is minted if the seed
   * doesn't carry one (honour an inbound X-Request-Id for cross-service
   * tracing; otherwise a UUID).
   */
  run<T>(seed: Partial<RequestContextStore>, fn: () => T): T {
    const store: RequestContextStore = {
      ...seed,
      requestId: seed.requestId || randomUUID(),
    };
    return storage.run(store, fn);
  },

  /** The active store, or undefined outside any request (cron, bootstrap). */
  get(): RequestContextStore | undefined {
    return storage.getStore();
  },

  /** The active correlation id, or undefined outside a request. */
  getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  },

  /**
   * Merge fields into the active store (no-op outside a request). Mutates in
   * place so values set after guards run are visible to the rest of the
   * continuation, including the same store already captured by closures.
   */
  set(patch: Partial<RequestContextStore>): void {
    const store = storage.getStore();
    if (!store) return;
    if (patch.requestId !== undefined) store.requestId = patch.requestId;
    if (patch.tenantId !== undefined) store.tenantId = patch.tenantId;
    if (patch.branchId !== undefined) store.branchId = patch.branchId;
    if (patch.userId !== undefined) store.userId = patch.userId;
  },

  /**
   * Return `meta` enriched with the active correlation fields. Existing keys
   * in `meta` win (an explicit override is never clobbered). Outside a request
   * `meta` is returned unchanged.
   */
  enrich<T extends Record<string, unknown>>(meta: T = {} as T): T {
    const store = storage.getStore();
    if (!store) return meta;
    const base: Record<string, unknown> = { requestId: store.requestId };
    if (store.tenantId) base.tenantId = store.tenantId;
    if (store.branchId) base.branchId = store.branchId;
    if (store.userId) base.userId = store.userId;
    return { ...base, ...meta } as T;
  },
};
