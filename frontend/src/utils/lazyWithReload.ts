import { lazy, type ComponentType } from 'react';

/**
 * Stale-chunk recovery for the code-split SPA.
 *
 * Vite fingerprints every route chunk (`ChangePlanPage-DNXSg6RE.js`). A deploy
 * ships a fresh container with NEW hashes and DELETES the old files. A tab that
 * loaded the app *before* the deploy is still running an entry bundle whose
 * chunk map points at the now-deleted hashes, so the first navigation to a
 * lazy route does `import('/assets/ChangePlanPage-<oldhash>.js')` → 404 →
 * "Failed to fetch dynamically imported module" → white screen until the user
 * manually hard-refreshes.
 *
 * The fix: when a dynamic import fails with a chunk-load error, hard-reload the
 * page ONCE. The reload re-fetches index.html (served `no-cache`), which points
 * at the current hashes, and the navigation succeeds transparently. A
 * session-scoped cooldown guards against an infinite reload loop if the chunk
 * is genuinely missing even after the reload (e.g. mid-deploy).
 */

/** Reload at most once per this window (ms) to avoid a reload loop. */
export const RELOAD_WINDOW_MS = 10_000;

/** Session-storage key holding the timestamp of the last recovery reload. */
const RELOAD_TS_KEY = 'spa-chunk-reload-ts';

// Rollup/Vite and webpack-style dynamic-import failure messages. Matching on
// the message keeps us resilient to the error being a plain Error (no useful
// `name`) which is what browsers throw for a failed module fetch.
const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|dynamically imported module/i;

/** True when `error` looks like a failed code-split chunk fetch. */
export function isChunkLoadError(error: unknown): boolean {
  if (error == null) return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'ChunkLoadError') return true;
  const message =
    typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';
  return CHUNK_ERROR_RE.test(message);
}

/**
 * True when a recovery reload happened too recently to reload again — i.e. the
 * reload didn't fix it, so suppress further reloads and let the error surface.
 */
export function withinReloadCooldown(now: number, lastReloadTs: number | null): boolean {
  if (lastReloadTs == null) return false;
  return now - lastReloadTs < RELOAD_WINDOW_MS;
}

/** Injectable side-effect seam — overridden in tests, defaulted in production. */
export interface ReloadDeps {
  reload: () => void;
  now: () => number;
  getLastReloadTs: () => number | null;
  setLastReloadTs: (ts: number) => void;
}

const defaultDeps: ReloadDeps = {
  reload: () => window.location.reload(),
  now: () => Date.now(),
  getLastReloadTs: () => {
    try {
      const raw = sessionStorage.getItem(RELOAD_TS_KEY);
      return raw == null ? null : Number(raw);
    } catch {
      return null; // storage disabled (private mode) — treat as "no prior reload"
    }
  },
  setLastReloadTs: (ts: number) => {
    try {
      sessionStorage.setItem(RELOAD_TS_KEY, String(ts));
    } catch {
      /* storage disabled — the worst case is we allow one more reload later */
    }
  },
};

/** Reload once if the cooldown allows. Returns whether a reload was triggered. */
function reloadOnce(deps: ReloadDeps): boolean {
  const now = deps.now();
  if (withinReloadCooldown(now, deps.getLastReloadTs())) return false;
  deps.setLastReloadTs(now);
  deps.reload();
  return true;
}

/**
 * Run a dynamic-import factory, recovering from a stale-chunk failure with a
 * one-shot reload. On a successful reload trigger the returned promise stays
 * pending forever — the document is about to be replaced, so resolving or
 * rejecting would only flash the Suspense fallback or the error boundary.
 */
export function loadWithReload<T>(
  factory: () => Promise<T>,
  deps: ReloadDeps = defaultDeps,
): Promise<T> {
  return factory().catch((error: unknown) => {
    if (isChunkLoadError(error) && reloadOnce(deps)) {
      return new Promise<T>(() => {}); // never settles; navigation takes over
    }
    throw error;
  });
}

/**
 * Drop-in replacement for `React.lazy` that auto-recovers from stale-chunk
 * import failures. Use for every code-split route so an open tab survives a
 * deploy instead of white-screening on the next navigation.
 */
// Mirrors React.lazy's `ComponentType<any>` constraint (not `unknown`) so the
// route components' own prop types flow through to the returned lazy component
// — pages like PaymentResultPage (outcome) / SubdomainQRMenuPage (subdomain)
// must keep accepting their props.
export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  deps: ReloadDeps = defaultDeps,
) {
  return lazy(() => loadWithReload(factory, deps));
}

/**
 * Register a global listener for Vite's `vite:preloadError`, fired when its
 * module-preload helper (used for route chunks) fails to fetch. This is the
 * second safety net alongside `lazyWithReload` — some preload failures surface
 * here rather than as a rejected `import()`. Call once at app startup.
 */
export function installChunkErrorReload(deps: ReloadDeps = defaultDeps): void {
  window.addEventListener('vite:preloadError', (event) => {
    // We own the recovery; stop Vite from rethrowing the error to the console.
    event.preventDefault?.();
    reloadOnce(deps);
  });
}
