import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The refcount is module-level state, so each test re-imports a fresh copy
 * via vi.resetModules to keep the count from leaking between tests.
 */
const load = () => import('./bodyScrollLock');

beforeEach(() => {
  vi.resetModules();
  document.body.style.overflow = 'unset';
});

describe('bodyScrollLock', () => {
  it('locks on first acquire and only unlocks on the LAST release', async () => {
    const { acquireBodyScrollLock, releaseBodyScrollLock } = await load();

    acquireBodyScrollLock(); // e.g. the cart drawer opens
    expect(document.body.style.overflow).toBe('hidden');

    acquireBodyScrollLock(); // a modal opens over it
    releaseBodyScrollLock(); // modal closes — drawer still open
    expect(document.body.style.overflow).toBe('hidden');

    releaseBodyScrollLock(); // drawer closes — last holder gone
    expect(document.body.style.overflow).toBe('unset');
  });

  it('an extra release neither goes negative nor breaks the next acquire', async () => {
    const { acquireBodyScrollLock, releaseBodyScrollLock } = await load();

    releaseBodyScrollLock(); // spurious release at count 0
    acquireBodyScrollLock();
    expect(document.body.style.overflow).toBe('hidden');

    releaseBodyScrollLock();
    expect(document.body.style.overflow).toBe('unset');
  });
});
