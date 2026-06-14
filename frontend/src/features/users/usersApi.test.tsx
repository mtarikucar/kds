import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

/**
 * Specs for usersApi — the self-service profile/email hooks. Each
 * mutation PATCHes its endpoint and invalidates the my-profile cache so
 * the account screen reflects the change.
 */

const getMock = vi.fn();
const patchMock = vi.fn();
vi.mock('../../lib/api', () => ({
  default: { get: (...a: unknown[]) => getMock(...a), patch: (...a: unknown[]) => patchMock(...a) },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));

import { useMyProfile, useUpdateProfile, useUpdateEmail } from './usersApi';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('useMyProfile', () => {
  it('GETs /users/me/profile under the my-profile key', async () => {
    getMock.mockResolvedValue({ data: { id: 'u1' } });
    const client = makeClient();
    const { result } = renderHook(() => useMyProfile(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/users/me/profile');
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['my-profile']);
  });
});

describe('useUpdateProfile', () => {
  it('PATCHes the profile and invalidates my-profile', async () => {
    patchMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateProfile(), { wrapper: wrapper(client) });
    result.current.mutate({ firstName: 'Sam', phone: '555' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(patchMock).toHaveBeenCalledWith('/users/me/profile', { firstName: 'Sam', phone: '555' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['my-profile'] });
    expect(toastSuccess).toHaveBeenCalled();
  });
});

describe('useUpdateEmail', () => {
  it('PATCHes the email with the current password and invalidates my-profile', async () => {
    patchMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateEmail(), { wrapper: wrapper(client) });
    result.current.mutate({ email: 'new@x.com', currentPassword: 'pw' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(patchMock).toHaveBeenCalledWith('/users/me/email', { email: 'new@x.com', currentPassword: 'pw' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['my-profile'] });
  });

  it('surfaces the server error on failure', async () => {
    patchMock.mockRejectedValue({ response: { data: { message: 'wrong password' } } });
    const client = makeClient();
    const { result } = renderHook(() => useUpdateEmail(), { wrapper: wrapper(client) });
    result.current.mutate({ email: 'x@x.com', currentPassword: 'bad' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith('wrong password');
  });
});
