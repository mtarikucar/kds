import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Fake axios instance returned by axios.create(); we capture its verb mocks
// and the interceptor registrations so the module can wire them up.
const h = vi.hoisted(() => {
  const instance = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };
  const store = {
    accessToken: 'sa-token' as string | null,
    refreshToken: 'sa-refresh' as string | null,
    setTempToken: vi.fn(),
    setAccessToken: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  };
  return { instance, store };
});

vi.mock('axios', () => ({
  default: {
    create: () => h.instance,
    post: vi.fn(),
  },
}));

vi.mock('../../../store/superAdminAuthStore', () => {
  const useSuperAdminAuthStore = Object.assign(() => h.store, {
    getState: () => h.store,
  });
  return { useSuperAdminAuthStore };
});

import {
  superAdminApi,
  useSuperAdminLogin,
  useVerify2FA,
  useDashboardStats,
  useTenants,
  useTenant,
  useUpdateTenantStatus,
  useUpdateTenantOverrides,
  usePlans,
  useCreatePlan,
  useChangeSubscriptionPlan,
  useAuditLogs,
} from './superAdminApi';

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.instance.get.mockReset();
  h.instance.post.mockReset();
  h.instance.patch.mockReset();
  h.instance.delete.mockReset();
  h.store.setTempToken.mockReset();
  h.store.login.mockReset();
  h.store.logout.mockReset();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
});

describe('superAdminApi module wiring', () => {
  it('registers request and response interceptors on the shared client', () => {
    expect(superAdminApi).toBe(h.instance);
    expect(h.instance.interceptors.request.use).toHaveBeenCalled();
    expect(h.instance.interceptors.response.use).toHaveBeenCalled();
  });
});

describe('superadmin auth mutations', () => {
  it('useSuperAdminLogin stores a temp token when 2FA setup is required', async () => {
    h.instance.post.mockResolvedValue({
      data: { requires2FASetup: true, tempToken: 'tmp' },
    });
    const { result } = renderHook(() => useSuperAdminLogin(), { wrapper });
    await result.current.mutateAsync({ email: 'a@b.c', password: 'pw' } as never);
    expect(h.instance.post).toHaveBeenCalledWith(
      '/superadmin/auth/login',
      expect.objectContaining({ email: 'a@b.c' }),
    );
    expect(h.store.setTempToken).toHaveBeenCalledWith('tmp', true);
    expect(h.store.login).not.toHaveBeenCalled();
  });

  it('useSuperAdminLogin logs in directly when tokens are returned', async () => {
    h.instance.post.mockResolvedValue({
      data: {
        accessToken: 'a',
        refreshToken: 'r',
        superAdmin: { id: 's1' },
      },
    });
    const { result } = renderHook(() => useSuperAdminLogin(), { wrapper });
    await result.current.mutateAsync({ email: 'a@b.c', password: 'pw' } as never);
    expect(h.store.login).toHaveBeenCalledWith({ id: 's1' }, 'a', 'r');
  });

  it('useVerify2FA logs in on a fully-authenticated response', async () => {
    h.instance.post.mockResolvedValue({
      data: { accessToken: 'a', refreshToken: 'r', superAdmin: { id: 's1' } },
    });
    const { result } = renderHook(() => useVerify2FA(), { wrapper });
    await result.current.mutateAsync({ code: '123456' } as never);
    expect(h.instance.post).toHaveBeenCalledWith(
      '/superadmin/auth/verify-2fa',
      { code: '123456' },
    );
    expect(h.store.login).toHaveBeenCalled();
  });
});

describe('superadmin queries', () => {
  it('useDashboardStats GETs the stats endpoint', async () => {
    h.instance.get.mockResolvedValue({ data: {} });
    renderHook(() => useDashboardStats(), { wrapper });
    await waitFor(() =>
      expect(h.instance.get).toHaveBeenCalledWith('/superadmin/dashboard/stats'),
    );
  });

  it('useTenants forwards filters as params', async () => {
    h.instance.get.mockResolvedValue({ data: { items: [] } });
    renderHook(() => useTenants({ search: 'acme' } as never), { wrapper });
    await waitFor(() =>
      expect(h.instance.get).toHaveBeenCalledWith('/superadmin/tenants', {
        params: { search: 'acme' },
      }),
    );
  });

  it('useTenant is disabled without an id', () => {
    const { result } = renderHook(() => useTenant(''), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('usePlans GETs the plans endpoint', async () => {
    h.instance.get.mockResolvedValue({ data: [] });
    renderHook(() => usePlans(), { wrapper });
    await waitFor(() =>
      expect(h.instance.get).toHaveBeenCalledWith('/superadmin/plans'),
    );
  });

  it('useAuditLogs forwards filters', async () => {
    h.instance.get.mockResolvedValue({ data: { items: [] } });
    renderHook(() => useAuditLogs({ action: 'login' } as never), { wrapper });
    await waitFor(() =>
      expect(h.instance.get).toHaveBeenCalledWith('/superadmin/audit-logs', {
        params: { action: 'login' },
      }),
    );
  });
});

describe('superadmin mutations', () => {
  it('useUpdateTenantStatus PATCHes the status endpoint and invalidates tenants', async () => {
    h.instance.patch.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateTenantStatus(), { wrapper });
    await result.current.mutateAsync({ id: 't1', status: 'suspended' });
    expect(h.instance.patch).toHaveBeenCalledWith(
      '/superadmin/tenants/t1/status',
      { status: 'suspended', reason: undefined },
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['superadmin', 'tenants'],
    });
  });

  it('useUpdateTenantOverrides invalidates the per-tenant override + detail caches', async () => {
    h.instance.patch.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateTenantOverrides(), { wrapper });
    await result.current.mutateAsync({ tenantId: 't1', data: {} as never });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['superadmin', 'tenants', 't1', 'overrides'],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['superadmin', 'tenants', 't1'],
    });
  });

  it('useCreatePlan POSTs and invalidates the plans cache', async () => {
    h.instance.post.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreatePlan(), { wrapper });
    await result.current.mutateAsync({ name: 'Pro' } as never);
    expect(h.instance.post).toHaveBeenCalledWith('/superadmin/plans', {
      name: 'Pro',
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['superadmin', 'plans'],
    });
  });

  it('useChangeSubscriptionPlan PATCHes and fans out invalidations', async () => {
    h.instance.patch.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useChangeSubscriptionPlan(), {
      wrapper,
    });
    await result.current.mutateAsync({ subscriptionId: 's1', planId: 'p2' });
    expect(h.instance.patch).toHaveBeenCalledWith(
      '/superadmin/subscriptions/s1',
      { planId: 'p2' },
    );
    const keys = invalidate.mock.calls.map((c) => (c[0] as any).queryKey);
    expect(keys).toContainEqual(['superadmin', 'subscriptions']);
    expect(keys).toContainEqual(['superadmin', 'tenants']);
    expect(keys).toContainEqual(['subscriptions']);
  });
});
