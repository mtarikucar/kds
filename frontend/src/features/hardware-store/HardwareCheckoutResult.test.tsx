import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';
import { useCartStore } from './cartStore';
import type { HardwareOrderSummary, HardwareProduct } from './storeApi';

/**
 * HardwareCheckoutResult renders the outcome of a PayTR round-trip for the
 * hardware checkout. PayTR's okUrl/failUrl are the SAME static returnUrl
 * regardless of outcome (see checkoutRef.ts), so the redirect itself carries
 * no verdict — the source of truth is whether a HardwareOrder has been
 * provisioned for this paymentRef yet. There's no GET-by-ref endpoint for
 * CheckoutIntent, so the component polls the tenant's existing order list
 * (useListHardwareOrders) and matches on paymentRef, following the same
 * poll-with-timeout pattern as subscription's PaymentResultPage.
 */

const ordersQuery: { data: HardwareOrderSummary[]; refetch: ReturnType<typeof vi.fn> } = {
  data: [],
  refetch: vi.fn(),
};

vi.mock('./storeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storeApi')>();
  return {
    ...actual,
    useListHardwareOrders: () => ordersQuery,
  };
});

import HardwareCheckoutResult from './HardwareCheckoutResult';

beforeEach(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
  ordersQuery.data = [];
  ordersQuery.refetch.mockReset();
  useCartStore.getState().clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function makeOrder(over: Partial<HardwareOrderSummary> = {}): HardwareOrderSummary {
  return {
    id: 'ord-1',
    status: 'paid',
    subtotalCents: 50000,
    taxCents: 9000,
    shippingCents: 2500,
    totalCents: 61500,
    currency: 'TRY',
    installation: null,
    paymentRef: 'CK-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    itemCount: 1,
    ...over,
  };
}

function makeProduct(): HardwareProduct {
  return {
    id: 'p-1',
    sku: 'KDS-15',
    category: 'kds',
    name: 'KDS Screen 15"',
    brand: 'Hummy',
    model: null,
    description: 'A screen',
    priceCents: 50000,
    rentalMonthlyCents: null,
    currency: 'TRY',
    warrantyMonths: 24,
    images: [],
    stockStatus: 'in_stock',
    saleMode: 'DIRECT_SALE',
  };
}

function renderResult(paymentRef = 'CK-1', onContinue = vi.fn()) {
  return render(
    <MemoryRouter>
      <HardwareCheckoutResult paymentRef={paymentRef} onContinue={onContinue} />
    </MemoryRouter>,
  );
}

describe('HardwareCheckoutResult', () => {
  it('shows the confirming/pending state while no matching order exists yet', () => {
    renderResult('CK-1');
    expect(screen.getByText(enHardware.store.checkoutResult.confirmingTitle)).toBeInTheDocument();
  });

  it('shows success once an order with the matching paymentRef appears, and clears the cart', () => {
    useCartStore.getState().addHardware(makeProduct(), { qty: 1, acquisition: 'sell' });
    expect(useCartStore.getState().lines).toHaveLength(1);

    ordersQuery.data = [makeOrder({ paymentRef: 'CK-1' })];
    renderResult('CK-1');

    expect(screen.getByText(enHardware.store.checkoutResult.successTitle)).toBeInTheDocument();
    expect(useCartStore.getState().lines).toHaveLength(0);
  });

  it('ignores an order whose paymentRef does not match', () => {
    ordersQuery.data = [makeOrder({ paymentRef: 'CK-other' })];
    renderResult('CK-1');
    expect(screen.getByText(enHardware.store.checkoutResult.confirmingTitle)).toBeInTheDocument();
  });

  it('shows the failed state once the poll times out with no matching order', async () => {
    vi.useFakeTimers();
    renderResult('CK-1');
    // Poll ticks every 2s; advance past the 30s timeout so a tick lands
    // strictly beyond it (30s exactly is still "still trying").
    await act(async () => {
      await vi.advanceTimersByTimeAsync(34_000);
    });
    expect(screen.getByText(enHardware.store.checkoutResult.failTitle)).toBeInTheDocument();
  });
});
