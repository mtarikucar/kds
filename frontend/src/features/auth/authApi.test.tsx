import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

/**
 * Specs for authApi — the auth mutations carry real cross-cutting logic
 * beyond a bare POST: useLogin/useGoogleAuth/useAppleAuth must clear the
 * whole React-Query cache (cross-tenant entitlement leak guard, v2.8.91)
 * AND push the user into the auth store; useLogout clears even when the
 * network call fails; useRegister branches its toast on pendingApproval;
 * useProfile is gated on accessToken and writes the fetched user back to
 * the store. We deep-mock the axios wrapper, the toast, i18n and the auth
 * store, then assert the exact store calls + cache transitions.
 */

const postMock = vi.fn();
const getMock = vi.fn();
vi.mock('../../lib/api', () => ({
  default: {
    post: (...a: unknown[]) => postMock(...a),
    get: (...a: unknown[]) => getMock(...a),
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));

const loginFn = vi.fn();
const logoutFn = vi.fn();
const setUserFn = vi.fn();
let storeState: any;
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (s: any) => unknown) => selector(storeState),
}));

// deep-review FL1 — useLogout must also clear the persisted branch scope.
const branchScopeClearFn = vi.fn();
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: {
    getState: () => ({ clear: branchScopeClearFn }),
  },
}));

import {
  useLogin,
  useRegister,
  useLogout,
  useProfile,
  useForgotPassword,
  useResetPassword,
  useGoogleAuth,
  useAppleAuth,
  useVerifyEmail,
} from './authApi';

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  storeState = {
    login: loginFn,
    logout: logoutFn,
    setUser: setUserFn,
    accessToken: 'tok',
    user: { id: 'u1', tenantId: 't1' },
  };
});

describe('useLogin', () => {
  it('clears the query cache then pushes the user+token into the auth store', async () => {
    postMock.mockResolvedValue({
      data: { user: { id: 'u9' }, accessToken: 'at-9' },
    });
    const client = new QueryClient();
    client.setQueryData(['stale-tenant-cache'], { secret: true });
    const clearSpy = vi.spyOn(client, 'clear');

    const { result } = renderHook(() => useLogin(), { wrapper: wrapper(client) });
    result.current.mutate({ email: 'a@b.com', password: 'pw' } as any);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/auth/login', { email: 'a@b.com', password: 'pw' });
    expect(clearSpy).toHaveBeenCalled();
    // Prior tenant's cache entry is gone after clear().
    expect(client.getQueryData(['stale-tenant-cache'])).toBeUndefined();
    expect(loginFn).toHaveBeenCalledWith({ id: 'u9' }, 'at-9');
    expect(toastSuccess).toHaveBeenCalledWith('common:notifications.loginSuccessful');
  });

  it('surfaces the server message on failure without touching the store', async () => {
    postMock.mockRejectedValue({ isAxiosError: true, response: { data: { message: 'bad creds' } } });
    const client = new QueryClient();
    const { result } = renderHook(() => useLogin(), { wrapper: wrapper(client) });
    result.current.mutate({ email: 'a@b.com', password: 'x' } as any);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(loginFn).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('bad creds');
  });
});

describe('useRegister', () => {
  it('shows the pending-approval message when the backend flags it', async () => {
    postMock.mockResolvedValue({ data: { pendingApproval: true, message: 'wait for admin' } });
    const client = new QueryClient();
    const { result } = renderHook(() => useRegister(), { wrapper: wrapper(client) });
    result.current.mutate({ email: 'a@b.com' } as any);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toastSuccess).toHaveBeenCalledWith('wait for admin');
  });

  it('shows the generic success toast when not pending approval', async () => {
    postMock.mockResolvedValue({ data: { user: {}, accessToken: 'a' } });
    const client = new QueryClient();
    const { result } = renderHook(() => useRegister(), { wrapper: wrapper(client) });
    result.current.mutate({ email: 'a@b.com' } as any);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(toastSuccess).toHaveBeenCalledWith('common:notifications.registrationSuccessful');
  });
});

describe('useLogout', () => {
  it('logs out and clears the cache on success', async () => {
    postMock.mockResolvedValue({ data: {} });
    const client = new QueryClient();
    const clearSpy = vi.spyOn(client, 'clear');
    const { result } = renderHook(() => useLogout(), { wrapper: wrapper(client) });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(logoutFn).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
    // deep-review FL1 — branch scope is dropped on a clean logout.
    expect(branchScopeClearFn).toHaveBeenCalled();
  });

  it('logs out and clears the cache EVEN when the API call fails', async () => {
    postMock.mockRejectedValue(new Error('offline'));
    const client = new QueryClient();
    const clearSpy = vi.spyOn(client, 'clear');
    const { result } = renderHook(() => useLogout(), { wrapper: wrapper(client) });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(logoutFn).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
    // deep-review FL1 — branch scope is dropped even when the API errors.
    expect(branchScopeClearFn).toHaveBeenCalled();
  });
});

describe('useProfile', () => {
  it('keys the query on userId+tenantId and writes the fetched user to the store', async () => {
    getMock.mockResolvedValue({ data: { id: 'u1', email: 'me@x.com' } });
    const client = new QueryClient();
    const { result } = renderHook(() => useProfile(), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/auth/profile');
    expect(setUserFn).toHaveBeenCalledWith({ id: 'u1', email: 'me@x.com' });
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['profile', 'u1', 't1']);
  });

  it('is disabled (no fetch) when there is no access token', async () => {
    storeState.accessToken = null;
    const client = new QueryClient();
    const { result } = renderHook(() => useProfile(), { wrapper: wrapper(client) });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getMock).not.toHaveBeenCalled();
  });
});

describe('useGoogleAuth / useAppleAuth cross-tenant cache clear', () => {
  it('useGoogleAuth clears cache + logs in with the OAuth credential', async () => {
    postMock.mockResolvedValue({ data: { user: { id: 'g1' }, accessToken: 'g-at' } });
    const client = new QueryClient();
    const clearSpy = vi.spyOn(client, 'clear');
    const { result } = renderHook(() => useGoogleAuth(), { wrapper: wrapper(client) });
    result.current.mutate('google-credential');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/auth/google', { credential: 'google-credential' });
    expect(clearSpy).toHaveBeenCalled();
    expect(loginFn).toHaveBeenCalledWith({ id: 'g1' }, 'g-at');
  });

  it('useAppleAuth forwards the identity token payload and clears cache', async () => {
    postMock.mockResolvedValue({ data: { user: { id: 'a1' }, accessToken: 'a-at' } });
    const client = new QueryClient();
    const clearSpy = vi.spyOn(client, 'clear');
    const { result } = renderHook(() => useAppleAuth(), { wrapper: wrapper(client) });
    result.current.mutate({ identityToken: 'idtok', firstName: 'Sam' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/auth/apple', { identityToken: 'idtok', firstName: 'Sam' });
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe('useVerifyEmail', () => {
  it('invalidates the profile query on success', async () => {
    postMock.mockResolvedValue({ data: { message: 'ok', verified: true } });
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useVerifyEmail(), { wrapper: wrapper(client) });
    result.current.mutate({ email: 'a@b.com', code: '123456' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/auth/verify-email', { email: 'a@b.com', code: '123456' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['profile'] });
  });
});

describe('useForgotPassword / useResetPassword payloads', () => {
  it('useForgotPassword wraps the bare email string into a body object', async () => {
    postMock.mockResolvedValue({ data: { message: 'sent' } });
    const client = new QueryClient();
    const { result } = renderHook(() => useForgotPassword(), { wrapper: wrapper(client) });
    result.current.mutate('user@x.com');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/auth/forgot-password', { email: 'user@x.com' });
  });

  it('useResetPassword forwards token + newPassword', async () => {
    postMock.mockResolvedValue({ data: { message: 'done' } });
    const client = new QueryClient();
    const { result } = renderHook(() => useResetPassword(), { wrapper: wrapper(client) });
    result.current.mutate({ token: 'tk', newPassword: 'np' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/auth/reset-password', { token: 'tk', newPassword: 'np' });
  });
});
