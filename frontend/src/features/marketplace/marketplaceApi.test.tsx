import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useListAddOns,
  usePurchaseAddOnViaCheckout,
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

// Auth store supplies the buyer (email/name/phone) for the PayTR basket.
let mockUser: any = { email: 'a@b.com', firstName: 'Ada', lastName: 'Lovelace', phone: '+905551112233' };
vi.mock('../../store/authStore', () => ({
  useAuthStore: { getState: () => ({ user: mockUser }) },
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

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { email: 'a@b.com', firstName: 'Ada', lastName: 'Lovelace', phone: '+905551112233' };
});

describe('useListAddOns', () => {
  it('passes the kind as a query param when provided', async () => {
    apiGet.mockResolvedValue({ data: [] });
    const client = makeClient();
    renderHook(() => useListAddOns('integration'), { wrapper: wrap(client) });
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet).toHaveBeenCalledWith('/v1/marketplace/addons/available', { params: { kind: 'integration' } });
  });

  it('sends an empty params object when no kind is given', async () => {
    apiGet.mockResolvedValue({ data: [] });
    const client = makeClient();
    renderHook(() => useListAddOns(undefined), { wrapper: wrap(client) });
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(apiGet).toHaveBeenCalledWith('/v1/marketplace/addons/available', { params: {} });
  });

  it('keys the catalogue query by kind', () => {
    expect(marketplaceKeys.catalog('software')).toEqual(['marketplace', 'catalog', 'software']);
    expect(marketplaceKeys.mine).toEqual(['marketplace', 'mine']);
  });
});

describe('usePurchaseAddOnViaCheckout', () => {
  // jsdom's location.assign is non-configurable, so swap the whole object.
  const realLocation = window.location;
  let assign: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { origin: 'http://localhost:3000', assign },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  });

  it('trades the add-on for a PayTR checkout intent and redirects to the payment link', async () => {
    apiPost.mockResolvedValue({
      data: { paymentRef: 'CK-abc', paymentLink: 'https://paytr.test/pay/CK-abc', amountCents: 9900, currency: 'TRY' },
    });
    const client = makeClient();
    const { result } = renderHook(() => usePurchaseAddOnViaCheckout(), { wrapper: wrap(client) });

    result.current.mutate({ addOnCode: 'kds_extra_screen' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Posts a single `addon` cart line + the buyer, NOT the free grant endpoint.
    expect(apiPost).toHaveBeenCalledWith(
      '/v1/checkout/intent',
      expect.objectContaining({
        cart: { items: [{ type: 'addon', code: 'kds_extra_screen', qty: 1, branchId: undefined }] },
        buyer: { email: 'a@b.com', name: 'Ada Lovelace', phone: '+905551112233' },
        returnUrl: expect.stringContaining('/admin/plan'),
      }),
    );
    // Hands off to PayTR's hosted page so payment is actually collected.
    expect(assign).toHaveBeenCalledWith('https://paytr.test/pay/CK-abc');
  });

  it('does not call the free /addons/purchase grant endpoint', async () => {
    apiPost.mockResolvedValue({ data: { paymentLink: 'https://paytr.test/x' } });
    const client = makeClient();
    const { result } = renderHook(() => usePurchaseAddOnViaCheckout(), { wrapper: wrap(client) });
    result.current.mutate({ addOnCode: 'kds_extra_screen' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiPost).not.toHaveBeenCalledWith('/v1/marketplace/addons/purchase', expect.anything());
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
