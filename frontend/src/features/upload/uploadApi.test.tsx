import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => h.get(...a),
    post: (...a: unknown[]) => h.post(...a),
    patch: (...a: unknown[]) => h.patch(...a),
    delete: (...a: unknown[]) => h.del(...a),
  },
}));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));
vi.mock('../../i18n/config', () => ({
  default: { t: (k: string) => k },
}));

import {
  useUploadProductImage,
  useUploadProductImages,
  useProductImages,
  useUnusedImages,
  useDeleteProductImage,
  useProductImagesForProduct,
  useReorderProductImages,
} from './uploadApi';

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  Object.values(h).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset());
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
});

describe('uploadApi queries', () => {
  it('useProductImages GETs the product-images endpoint', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useProductImages(), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/upload/product-images'),
    );
  });

  it('useUnusedImages GETs the unused endpoint', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useUnusedImages(), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/upload/product-images/unused'),
    );
  });

  it('useProductImagesForProduct is disabled without a productId', () => {
    const { result } = renderHook(() => useProductImagesForProduct(''), {
      wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(h.get).not.toHaveBeenCalled();
  });

  it('useProductImagesForProduct fetches when a productId is given', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useProductImagesForProduct('p1'), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/menu/products/p1/images'),
    );
  });
});

describe('uploadApi mutations', () => {
  it('useUploadProductImage posts multipart form data and toasts success', async () => {
    h.post.mockResolvedValue({ data: { id: 'img1' } });
    const { result } = renderHook(() => useUploadProductImage(), { wrapper });
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await result.current.mutateAsync(file);
    expect(h.post).toHaveBeenCalledWith(
      '/upload/product-image',
      expect.any(FormData),
      expect.objectContaining({
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    );
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('useUploadProductImages appends every file under "images"', async () => {
    h.post.mockResolvedValue({ data: { count: 2 } });
    const { result } = renderHook(() => useUploadProductImages(), { wrapper });
    const files = [
      new File(['x'], 'a.png', { type: 'image/png' }),
      new File(['y'], 'b.png', { type: 'image/png' }),
    ];
    await result.current.mutateAsync(files);
    const formData = h.post.mock.calls[0][1] as FormData;
    expect(formData.getAll('images')).toHaveLength(2);
  });

  it('useDeleteProductImage deletes by id and toasts success', async () => {
    h.del.mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useDeleteProductImage(), { wrapper });
    await result.current.mutateAsync('img-9');
    expect(h.del).toHaveBeenCalledWith('/upload/product-image/img-9');
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('useReorderProductImages patches the reorder endpoint with ids', async () => {
    h.patch.mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useReorderProductImages(), { wrapper });
    await result.current.mutateAsync({ productId: 'p1', imageIds: ['a', 'b'] });
    expect(h.patch).toHaveBeenCalledWith('/menu/products/p1/images/reorder', {
      imageIds: ['a', 'b'],
    });
  });

  it('surfaces a server error message on failure', async () => {
    h.post.mockRejectedValue({
      response: { data: { message: 'boom' } },
    });
    const { result } = renderHook(() => useUploadProductImage(), { wrapper });
    await result.current
      .mutateAsync(new File(['x'], 'a.png', { type: 'image/png' }))
      .catch(() => undefined);
    expect(h.toastError).toHaveBeenCalledWith('boom');
  });
});
