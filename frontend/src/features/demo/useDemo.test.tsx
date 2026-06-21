import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useEnterDemo, useExitDemo } from './useDemo';
import { useAuthStore } from '../../store/authStore';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import { UserRole } from '../../types';
import type { User } from '../../types';
import api from '../../lib/api';

/**
 * Guards the demo enter/exit flow: a real session must be stashed, the demo
 * token + demo branch must be installed BEFORE the cache clears, and exit must
 * restore the real account. A regression here either strands the user in demo
 * or leaks demo context (token/branch) into their real account.
 */

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<object>);
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../i18n/config', () => ({
  default: { t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k },
}));
vi.mock('../../lib/api', () => ({ default: { post: vi.fn() } }));

const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

function realUser(): User {
  return {
    id: 'real-1',
    email: 'real@x.com',
    firstName: 'R',
    lastName: 'L',
    role: UserRole.ADMIN,
    tenantId: 'real-tenant',
    primaryBranchId: 'real-branch',
    allowedBranchIds: [],
  } as User;
}

const demoSession = {
  accessToken: 'demo-token',
  user: {
    id: 'demo-1',
    email: 'demo-admin@demo.hummytummy.local',
    firstName: 'Demo',
    lastName: 'Yönetici',
    role: UserRole.ADMIN,
    tenantId: 'demo-tenant',
    primaryBranchId: 'demo-branch',
    allowedBranchIds: [] as string[],
    isDemo: true as const,
  },
};

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useDemo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().logout();
    useBranchScopeStore.getState().clear();
    localStorage.clear();
    // Start from a real, branch-scoped session.
    useAuthStore.getState().login(realUser(), 'real-token');
    useBranchScopeStore.getState().hydrateFromUser(realUser());
  });

  it('enterDemo installs the demo token + branch and navigates to the dashboard', async () => {
    postMock.mockResolvedValueOnce({ data: demoSession });
    const { result } = renderHook(() => useEnterDemo(), { wrapper });

    await act(async () => {
      await result.current.enterDemo();
    });

    expect(postMock).toHaveBeenCalledWith('/auth/demo-session');
    const auth = useAuthStore.getState();
    expect(auth.demoMode).toBe(true);
    expect(auth.accessToken).toBe('demo-token');
    expect(auth.user?.email).toBe('demo-admin@demo.hummytummy.local');
    // branch scope re-pointed at the demo branch (so X-Branch-Id is demo's)
    expect(useBranchScopeStore.getState().branchId).toBe('demo-branch');
    expect(useBranchScopeStore.getState().tenantId).toBe('demo-tenant');
    expect(navigateMock).toHaveBeenCalledWith('/dashboard');
  });

  it('enterDemo returns false and stays on the real session when the API fails', async () => {
    postMock.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useEnterDemo(), { wrapper });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.enterDemo();
    });

    expect(ok).toBe(false);
    const auth = useAuthStore.getState();
    expect(auth.demoMode).toBe(false);
    expect(auth.accessToken).toBe('real-token');
    expect(useBranchScopeStore.getState().branchId).toBe('real-branch');
  });

  it('exitDemo restores the real token + branch and navigates home', async () => {
    postMock.mockResolvedValueOnce({ data: demoSession });
    const enter = renderHook(() => useEnterDemo(), { wrapper });
    await act(async () => {
      await enter.result.current.enterDemo();
    });
    expect(useAuthStore.getState().demoMode).toBe(true);

    const exit = renderHook(() => useExitDemo(), { wrapper });
    act(() => exit.result.current.exitDemo());

    const auth = useAuthStore.getState();
    expect(auth.demoMode).toBe(false);
    expect(auth.accessToken).toBe('real-token');
    expect(auth.user?.email).toBe('real@x.com');
    expect(useBranchScopeStore.getState().branchId).toBe('real-branch');
    expect(useBranchScopeStore.getState().tenantId).toBe('real-tenant');
    expect(navigateMock).toHaveBeenLastCalledWith('/dashboard');
  });

  it('enterDemo while already in demo is a no-op switch (no second API call)', async () => {
    postMock.mockResolvedValueOnce({ data: demoSession });
    const { result } = renderHook(() => useEnterDemo(), { wrapper });
    await act(async () => {
      await result.current.enterDemo();
    });
    postMock.mockClear();

    await act(async () => {
      await result.current.enterDemo();
    });
    expect(postMock).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenLastCalledWith('/dashboard');
  });
});
