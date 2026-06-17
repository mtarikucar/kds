import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Regression guard for the v3.0.0 branch-switch-over-socket contract.
 *
 * `initializeSocket` / `initializeNotificationSocket` each wire a
 * `branchScopeStore` subscription that emits `switchBranch` to the live
 * socket when the active branch changes, so the backend gateway can move
 * the connection between (tenantId, branchId) rooms WITHOUT a reconnect.
 * Before this suite that mechanism had zero coverage.
 *
 * The emit must fire ONLY when: the branch actually changed, the socket is
 * connected, and the new branchId is non-null. Module state is reset per
 * test because the socket is a module-level singleton and the store
 * subscription accumulates across `initialize*` calls.
 */

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}));

type FakeSocket = {
  connected: boolean;
  auth: Record<string, unknown>;
  emit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

function makeFakeSocket(connected: boolean): FakeSocket {
  return {
    connected,
    auth: {},
    emit: vi.fn(),
    on: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

async function loadFreshModules(connected: boolean) {
  const { io } = await import('socket.io-client');
  const fake = makeFakeSocket(connected);
  (io as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fake);
  const socketModule = await import('./socket');
  const { useBranchScopeStore } = await import('../store/branchScopeStore');
  return { fake, socketModule, useBranchScopeStore };
}

describe('socket switchBranch emit', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('emits switchBranch on the KDS socket when the branch changes while connected', async () => {
    const { fake, socketModule, useBranchScopeStore } =
      await loadFreshModules(true);
    useBranchScopeStore.setState({ branchId: 'b-1' });
    socketModule.initializeSocket();

    useBranchScopeStore.setState({ branchId: 'b-2' });

    expect(fake.emit).toHaveBeenCalledTimes(1);
    expect(fake.emit).toHaveBeenCalledWith('switchBranch', { branchId: 'b-2' });
  });

  it('does NOT emit when the socket is disconnected', async () => {
    const { fake, socketModule, useBranchScopeStore } =
      await loadFreshModules(false);
    useBranchScopeStore.setState({ branchId: 'b-1' });
    socketModule.initializeSocket();

    useBranchScopeStore.setState({ branchId: 'b-2' });

    expect(fake.emit).not.toHaveBeenCalled();
  });

  it('does NOT emit when the branch is cleared (new branchId null)', async () => {
    const { fake, socketModule, useBranchScopeStore } =
      await loadFreshModules(true);
    useBranchScopeStore.setState({ branchId: 'b-1' });
    socketModule.initializeSocket();

    useBranchScopeStore.setState({ branchId: null });

    expect(fake.emit).not.toHaveBeenCalled();
  });

  it('does NOT emit when an unrelated field changes but the branch is unchanged', async () => {
    const { fake, socketModule, useBranchScopeStore } =
      await loadFreshModules(true);
    useBranchScopeStore.setState({ branchId: 'b-1' });
    socketModule.initializeSocket();

    // Same branchId, different field — must not trigger a room move.
    useBranchScopeStore.setState({ isPinned: true });

    expect(fake.emit).not.toHaveBeenCalled();
  });

  it('also emits switchBranch on the notifications socket when the branch changes', async () => {
    const { fake, socketModule, useBranchScopeStore } =
      await loadFreshModules(true);
    useBranchScopeStore.setState({ branchId: 'b-1' });
    socketModule.initializeNotificationSocket();

    useBranchScopeStore.setState({ branchId: 'b-2' });

    expect(fake.emit).toHaveBeenCalledWith('switchBranch', { branchId: 'b-2' });
  });

  /**
   * deep-review FM1/FM4 — the store subscriptions are registered ONCE at module
   * load, so an init→disconnect→init cycle must NOT accumulate a second
   * subscriber. A single accessToken rotation therefore reconnects the live
   * socket exactly once, not once per cycle.
   */
  it('reconnects on accessToken change exactly once after an init/disconnect/init cycle', async () => {
    const { io } = await import('socket.io-client');
    // disconnect() must be chainable because prod calls .disconnect().connect()
    const fake: FakeSocket = {
      connected: true,
      auth: {},
      emit: vi.fn(),
      on: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    fake.disconnect.mockReturnValue(fake);
    (io as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fake);

    const socketModule = await import('./socket');
    const { useAuthStore } = await import('../store/authStore');

    socketModule.initializeSocket();
    socketModule.disconnectSocket();
    socketModule.initializeSocket();

    // Ignore the disconnect/connect churn from the init/disconnect cycle above;
    // only the reconnect triggered by the token rotation matters here.
    fake.disconnect.mockClear();
    fake.connect.mockClear();

    useAuthStore.setState({ accessToken: 'rotated-token' });

    // Exactly one reconnect — would be 2+ if a stale subscription leaked
    // (one extra disconnect().connect() per init/disconnect/init cycle).
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });
});
