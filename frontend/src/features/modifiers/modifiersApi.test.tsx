import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

/**
 * Specs for modifiersApi. The query hooks bake branchId into their keys
 * and forward the includeInactive/groupId params; the assignment
 * mutations invalidate a PRODUCT-SCOPED key (so only the affected
 * product's modifier list refetches) plus the global products list.
 */

const getMock = vi.fn();
const postMock = vi.fn();
const putMock = vi.fn();
const deleteMock = vi.fn();
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
    put: (...a: unknown[]) => putMock(...a),
    delete: (...a: unknown[]) => deleteMock(...a),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (selector: (s: any) => unknown) => selector({ branchId: 'b-1' }),
}));

import {
  useModifierGroups,
  useModifiers,
  useUpdateModifierGroup,
  useAssignModifiersToProduct,
  useRemoveModifierGroupFromProduct,
} from './modifiersApi';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('useModifierGroups', () => {
  it('forwards includeInactive and bakes it + branchId into the key', async () => {
    getMock.mockResolvedValue({ data: [] });
    const client = makeClient();
    const { result } = renderHook(() => useModifierGroups(true), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/modifiers/groups', { params: { includeInactive: true } });
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['modifier-groups', true, 'b-1']);
  });
});

describe('useModifiers', () => {
  it('forwards groupId + includeUnavailable params', async () => {
    getMock.mockResolvedValue({ data: [] });
    const client = makeClient();
    const { result } = renderHook(() => useModifiers('g-1', true), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/modifiers', { params: { groupId: 'g-1', includeUnavailable: true } });
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['modifiers', 'g-1', true, 'b-1']);
  });
});

describe('useUpdateModifierGroup', () => {
  it('PUTs to the id-scoped URL and invalidates modifier-groups', async () => {
    putMock.mockResolvedValue({ data: { id: 'g-1' } });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateModifierGroup(), { wrapper: wrapper(client) });
    result.current.mutate({ id: 'g-1', data: { name: 'Sauces' } as any });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(putMock).toHaveBeenCalledWith('/modifiers/groups/g-1', { name: 'Sauces' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['modifier-groups'] });
  });
});

describe('useAssignModifiersToProduct', () => {
  it('POSTs the assignment and invalidates the product-scoped + products keys', async () => {
    postMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useAssignModifiersToProduct(), { wrapper: wrapper(client) });
    result.current.mutate({ productId: 'p-9', data: { groupIds: ['g-1'] } as any });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/modifiers/products/p-9/assign', { groupIds: ['g-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['product-modifiers', 'p-9'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['products'] });
  });
});

describe('useRemoveModifierGroupFromProduct', () => {
  it('DELETEs the product/group pair and invalidates the product-scoped key', async () => {
    deleteMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRemoveModifierGroupFromProduct(), { wrapper: wrapper(client) });
    result.current.mutate({ productId: 'p-9', groupId: 'g-2' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteMock).toHaveBeenCalledWith('/modifiers/products/p-9/groups/g-2');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['product-modifiers', 'p-9'] });
  });
});
