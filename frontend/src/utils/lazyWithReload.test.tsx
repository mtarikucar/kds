import { describe, it, expect, vi } from 'vitest';
import { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import {
  isChunkLoadError,
  withinReloadCooldown,
  loadWithReload,
  installChunkErrorReload,
  lazyWithReload,
  RELOAD_WINDOW_MS,
  type ReloadDeps,
} from './lazyWithReload';

/**
 * After a deploy replaces the hashed bundle files, an already-open tab's
 * entry chunk still references the OLD hashes, which now 404. These helpers
 * turn that white-screen into a one-shot hard reload that pulls the fresh
 * index.html → new hashes. The loop guard (reload at most once per window)
 * is the load-bearing bit: without it a chunk that's genuinely gone would
 * reload forever.
 */

const CHUNK_MESSAGES = [
  'Failed to fetch dynamically imported module: https://x/assets/ChangePlanPage-DNXSg6RE.js',
  'error loading dynamically imported module: /assets/PlanCard-BwuQbe4a.js',
  'Importing a module script failed.',
];

describe('isChunkLoadError', () => {
  it.each(CHUNK_MESSAGES)('matches the stale-chunk message %#', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it('matches a ChunkLoadError by name even with an unrelated message', () => {
    const err = Object.assign(new Error('boom'), { name: 'ChunkLoadError' });
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('does NOT match an ordinary application error', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('is safe on null / undefined / non-error values', () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(42)).toBe(false);
  });
});

describe('withinReloadCooldown', () => {
  it('allows a reload when there is no prior reload (returns false)', () => {
    expect(withinReloadCooldown(1_000, null)).toBe(false);
  });

  it('suppresses a reload within the window of the last reload (returns true)', () => {
    const lastTs = 5_000 - (RELOAD_WINDOW_MS - 1);
    expect(withinReloadCooldown(5_000, lastTs)).toBe(true);
  });

  it('allows a reload once the window has fully elapsed', () => {
    expect(withinReloadCooldown(50_000, 50_000 - RELOAD_WINDOW_MS)).toBe(false);
  });
});

function makeDeps(overrides: Partial<ReloadDeps> = {}): ReloadDeps {
  let stored: number | null = null;
  return {
    reload: vi.fn(),
    now: () => 1_000_000,
    getLastReloadTs: () => stored,
    setLastReloadTs: (ts: number) => {
      stored = ts;
    },
    ...overrides,
  };
}

describe('loadWithReload', () => {
  it('returns the imported module on success, without reloading', async () => {
    const deps = makeDeps();
    const mod = { default: () => null };
    await expect(loadWithReload(() => Promise.resolve(mod), deps)).resolves.toBe(mod);
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it('reloads once on a stale-chunk failure and leaves the promise pending', async () => {
    const deps = makeDeps();
    const chunkErr = new Error(CHUNK_MESSAGES[0]);

    let settled = false;
    void loadWithReload(() => Promise.reject(chunkErr), deps).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.reload).toHaveBeenCalledTimes(1);
    // Hangs until the reload swaps the document — settling would flash the
    // Suspense fallback or surface the error to the boundary.
    expect(settled).toBe(false);
  });

  it('does NOT reload again when one already happened within the cooldown', async () => {
    const deps = makeDeps({ getLastReloadTs: () => 1_000_000 - 1 });
    const chunkErr = new Error(CHUNK_MESSAGES[0]);
    await expect(loadWithReload(() => Promise.reject(chunkErr), deps)).rejects.toBe(chunkErr);
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it('rethrows a non-chunk error without reloading', async () => {
    const deps = makeDeps();
    const appErr = new Error('boom');
    await expect(loadWithReload(() => Promise.reject(appErr), deps)).rejects.toBe(appErr);
    expect(deps.reload).not.toHaveBeenCalled();
  });
});

describe('installChunkErrorReload', () => {
  it('reloads once when Vite emits vite:preloadError', () => {
    const deps = makeDeps();
    installChunkErrorReload(deps);

    window.dispatchEvent(new Event('vite:preloadError'));
    expect(deps.reload).toHaveBeenCalledTimes(1);

    // A second preload error within the cooldown must not reload again.
    window.dispatchEvent(new Event('vite:preloadError'));
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });
});

describe('lazyWithReload (React integration)', () => {
  it('recovers from a stale chunk by reloading instead of crashing to the boundary', async () => {
    const deps = makeDeps();
    const chunkErr = new Error(CHUNK_MESSAGES[0]);
    const Lazy = lazyWithReload(() => Promise.reject(chunkErr), deps);

    render(
      <Suspense fallback={<div>loading</div>}>
        <Lazy />
      </Suspense>,
    );

    await waitFor(() => expect(deps.reload).toHaveBeenCalledTimes(1));
    // Still showing the fallback — no crash, no error fallback rendered.
    expect(screen.getByText('loading')).toBeInTheDocument();
  });
});
