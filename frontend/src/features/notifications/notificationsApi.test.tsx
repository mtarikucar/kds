import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ── Mocks ────────────────────────────────────────────────────────────────
// useNotificationSocket's real logic is: it only opens a socket when
// authenticated, it routes each notification.type to the matching toast
// variant (SUCCESS/INFO/WARNING/ERROR/default), and it prepends the
// notification into the branch-scoped query cache. We capture the socket
// callback and drive it directly.

// vi.mock factories are hoisted above all top-level consts, so the shared
// mock state must be created with vi.hoisted to be reachable inside them.
const h = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  });
  return {
    initSocket: vi.fn(),
    disconnectSocket: vi.fn(),
    toast,
    authState: { accessToken: 'tok' as string | null },
    branchScope: { branchId: 'branch-A' as string | null },
  };
});
const { initSocket, disconnectSocket, toast, authState, branchScope } = h;

vi.mock('../../lib/socket', () => ({
  initializeNotificationSocket: (cb: (n: unknown) => void) => h.initSocket(cb),
  disconnectNotificationSocket: () => h.disconnectSocket(),
}));

vi.mock('sonner', () => ({ toast: h.toast }));

vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (s: typeof h.authState) => unknown) =>
    selector(h.authState),
}));

vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: Object.assign(
    (selector: (s: typeof h.branchScope) => unknown) => selector(h.branchScope),
    { getState: () => h.branchScope },
  ),
}));

import { useNotificationSocket } from './notificationsApi';

function setup() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const utils = renderHook(() => useNotificationSocket(), { wrapper });
  return { client, ...utils };
}

/** Pull the callback passed into initializeNotificationSocket. */
function emittedCallback(): (n: unknown) => void {
  return initSocket.mock.calls[0][0];
}

beforeEach(() => {
  initSocket.mockReset();
  disconnectSocket.mockReset();
  toast.mockReset();
  toast.success.mockReset();
  toast.info.mockReset();
  toast.warning.mockReset();
  toast.error.mockReset();
  authState.accessToken = 'tok';
  branchScope.branchId = 'branch-A';
});

describe('useNotificationSocket auth gating', () => {
  it('does NOT open a socket when unauthenticated', () => {
    authState.accessToken = null;
    setup();
    expect(initSocket).not.toHaveBeenCalled();
  });

  it('opens a socket when authenticated and disconnects on unmount', () => {
    const { unmount } = setup();
    expect(initSocket).toHaveBeenCalledTimes(1);
    unmount();
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
  });
});

describe('useNotificationSocket toast routing', () => {
  it.each([
    ['SUCCESS', 'success'],
    ['INFO', 'info'],
    ['WARNING', 'warning'],
    ['ERROR', 'error'],
  ] as const)('routes type %s to toast.%s', (type, method) => {
    setup();
    emittedCallback()({ type, title: 'T', message: 'M' });
    expect((toast as any)[method]).toHaveBeenCalledWith('T', { description: 'M' });
  });

  it('falls back to the plain toast() for an unrecognised type', () => {
    setup();
    emittedCallback()({ type: 'WEIRD', title: 'T', message: 'M' });
    expect(toast).toHaveBeenCalledWith('T', { description: 'M' });
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('useNotificationSocket cache write', () => {
  it('seeds the branch-scoped cache key when it is empty', () => {
    const { client } = setup();
    const notification = { type: 'INFO', title: 'A', message: 'B' };
    emittedCallback()(notification);
    expect(client.getQueryData(['notifications', 'branch-A'])).toEqual([
      notification,
    ]);
  });

  it('prepends new notifications ahead of existing ones', () => {
    const { client } = setup();
    const first = { type: 'INFO', title: 'first', message: '1' };
    const second = { type: 'INFO', title: 'second', message: '2' };
    const cb = emittedCallback();
    cb(first);
    cb(second);
    expect(client.getQueryData(['notifications', 'branch-A'])).toEqual([
      second,
      first,
    ]);
  });
});
