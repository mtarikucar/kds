import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateContactMessage } from './index';
import type { ContactFormData } from '../../types/contact';

// Mock the axios wrapper so we assert the request shape without a network.
const post = vi.fn();
vi.mock('../../lib/api', () => ({
  default: { post: (...args: any[]) => post(...args) },
}));

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: any) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.clearAllMocks());

describe('useCreateContactMessage', () => {
  it('POSTs the form data to /contact and resolves with the response body', async () => {
    post.mockResolvedValue({ data: { id: 'msg-1', status: 'received' } });
    const { result } = renderHook(() => useCreateContactMessage(), { wrapper: wrapper() });

    const payload: ContactFormData = {
      name: 'Pat',
      email: 'pat@x.com',
      subject: 'Help',
      message: 'Need a demo',
    } as ContactFormData;

    result.current.mutate(payload);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(post).toHaveBeenCalledWith('/contact', payload);
    expect(result.current.data).toEqual({ id: 'msg-1', status: 'received' });
  });

  it('surfaces an error when the request rejects', async () => {
    post.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useCreateContactMessage(), { wrapper: wrapper() });

    result.current.mutate({ name: 'X', email: 'x@x.com', subject: 's', message: 'm' } as ContactFormData);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
