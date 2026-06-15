import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useCustomers,
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
} from './customersApi';

// --- mocks --------------------------------------------------------------

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: any[]) => apiGet(...a),
    post: (...a: any[]) => apiPost(...a),
    patch: (...a: any[]) => apiPatch(...a),
    delete: (...a: any[]) => apiDelete(...a),
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (m: any) => toastSuccess(m), error: (m: any) => toastError(m) } }));
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));

// Branch scope store: customers query key is scoped by the active branch id.
let branchId: string | null = 'branch-7';
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (selector: any) => selector({ branchId }),
}));

function makeClient() {
  return new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
}
function wrap(client: QueryClient) {
  return ({ children }: any) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  branchId = 'branch-7';
});

describe('useCustomers', () => {
  it('fetches /customers and returns the paginated body, keyed by branch', async () => {
    apiGet.mockResolvedValue({ data: { data: [{ id: '1' }], total: 1 } });
    const client = makeClient();
    const { result } = renderHook(() => useCustomers(), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiGet).toHaveBeenCalledWith('/customers');
    expect(result.current.data).toEqual({ data: [{ id: '1' }], total: 1 });
    // The query cache entry is scoped to the active branch.
    expect(client.getQueryData(['customers', 'branch-7'])).toBeDefined();
  });
});

describe('useCreateCustomer', () => {
  it('posts to /customers, invalidates the list, and toasts success', async () => {
    apiPost.mockResolvedValue({ data: { id: 'new' } });
    const client = makeClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateCustomer(), { wrapper: wrap(client) });

    result.current.mutate({ name: 'Acme' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(apiPost).toHaveBeenCalledWith('/customers', { name: 'Acme' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customers'] });
    expect(toastSuccess).toHaveBeenCalledWith('common:notifications.customerCreatedSuccessfully');
  });

  it('toasts the server message on error', async () => {
    apiPost.mockRejectedValue({ isAxiosError: true, response: { data: { message: 'Name taken' } } });
    const client = makeClient();
    const { result } = renderHook(() => useCreateCustomer(), { wrapper: wrap(client) });

    result.current.mutate({ name: 'Dup' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith('Name taken');
  });

  it('falls back to a generic message when the error has no server message', async () => {
    apiPost.mockRejectedValue({});
    const client = makeClient();
    const { result } = renderHook(() => useCreateCustomer(), { wrapper: wrap(client) });

    result.current.mutate({ name: 'X' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith('common:notifications.operationFailed');
  });
});

describe('useUpdateCustomer', () => {
  it('patches /customers/:id with the data payload', async () => {
    apiPatch.mockResolvedValue({ data: { id: 'c9' } });
    const client = makeClient();
    const { result } = renderHook(() => useUpdateCustomer(), { wrapper: wrap(client) });

    result.current.mutate({ id: 'c9', data: { name: 'Renamed' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiPatch).toHaveBeenCalledWith('/customers/c9', { name: 'Renamed' });
    expect(toastSuccess).toHaveBeenCalledWith('common:notifications.customerUpdatedSuccessfully');
  });
});

describe('useDeleteCustomer', () => {
  it('deletes /customers/:id and invalidates the list', async () => {
    apiDelete.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteCustomer(), { wrapper: wrap(client) });

    result.current.mutate('c-del');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiDelete).toHaveBeenCalledWith('/customers/c-del');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customers'] });
    expect(toastSuccess).toHaveBeenCalledWith('common:notifications.customerDeletedSuccessfully');
  });
});
