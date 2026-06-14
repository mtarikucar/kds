import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useListAddOns,
  usePurchaseAddOn,
  useCancelAddOn,
  marketplaceKeys,
} from './marketplaceApi';

// --- mocks --------------------------------------------------------------

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    get: (...a: any[]) => apiGet(...a),
    post: (...a: any[]) => apiPost(...a),
    delete: (...a: any[]) => apiDelete(...a),
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (m: any) => toastSuccess(m), error: (m: any) => toastError(m) } }));
vi.mock('../../i18n/config', () => ({ default: { t: (_k: string, o: any) => o?.defaultValue ?? _k } }));
vi.mock('../../lib/api-error', () => ({ getApiErrorMessage: (_e: any, fallback: string) => fallback }));

function makeClient() {
  return new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
}
function wrap(client: QueryClient) {
  return ({ children }: any) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.clearAllMocks());

describe('useListAddOns', () => {
  it('passes the kind as a query param when provided', async () => {
    apiGet.mockResolvedValue({ data: [] });
    const client = makeClient();
    renderHook(() => useListAddOns('integration'), { wrapper: wrap(client) });
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet).toHaveBeenCalledWith('/v1/marketplace/addons', { params: { kind: 'integration' } });
  });

  it('sends an empty params object when no kind is given', async () => {
    apiGet.mockResolvedValue({ data: [] });
    const client = makeClient();
    renderHook(() => useListAddOns(undefined), { wrapper: wrap(client) });
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet).toHaveBeenCalledWith('/v1/marketplace/addons', { params: {} });
  });

  it('keys the catalogue query by kind', () => {
    expect(marketplaceKeys.catalog('software')).toEqual(['marketplace', 'catalog', 'software']);
    expect(marketplaceKeys.mine).toEqual(['marketplace', 'mine']);
  });
});

describe('usePurchaseAddOn', () => {
  it('posts the input and invalidates mine + entitlements + effective-features on success', async () => {
    apiPost.mockResolvedValue({ data: { id: 'ta1' } });
    const client = makeClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => usePurchaseAddOn(), { wrapper: wrap(client) });

    result.current.mutate({ addOnCode: 'pos-pro' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith('/v1/marketplace/addons/purchase', { addOnCode: 'pos-pro' });
    const invalidatedKeys = invalidate.mock.calls.map((c) => (c[0] as any).queryKey);
    expect(invalidatedKeys).toContainEqual(['marketplace', 'mine']);
    expect(invalidatedKeys).toContainEqual(['entitlements', 'me']);
    expect(invalidatedKeys).toContainEqual(['subscriptions', 'effective-features']);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('surfaces the fallback error message via toast on failure', async () => {
    apiPost.mockRejectedValue(new Error('nope'));
    const client = makeClient();
    const { result } = renderHook(() => usePurchaseAddOn(), { wrapper: wrap(client) });

    result.current.mutate({ addOnCode: 'x' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith('Purchase failed');
  });
});

describe('useCancelAddOn', () => {
  it('defaults the immediate query param to "false"', async () => {
    apiDelete.mockResolvedValue({ data: {} });
    const client = makeClient();
    const { result } = renderHook(() => useCancelAddOn(), { wrapper: wrap(client) });

    result.current.mutate({ id: 'row-1' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiDelete).toHaveBeenCalledWith('/v1/marketplace/addons/row-1', {
      params: { immediate: 'false' },
    });
  });

  it('serializes immediate=true to the string "true"', async () => {
    apiDelete.mockResolvedValue({ data: {} });
    const client = makeClient();
    const { result } = renderHook(() => useCancelAddOn(), { wrapper: wrap(client) });

    result.current.mutate({ id: 'row-2', immediate: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiDelete).toHaveBeenCalledWith('/v1/marketplace/addons/row-2', {
      params: { immediate: 'true' },
    });
  });
});
