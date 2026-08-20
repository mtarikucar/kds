import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import CatalogStore from './CatalogStore';

/**
 * Semt has no catalog row on purpose: it is free and unbuilt, and a published
 * zero-price row would punch through purchase()'s payment gate. So the shop
 * window carries a static line instead — one the customer can read and cannot
 * buy. Two render sites matter, because a tenant whose filtered catalog is
 * empty takes the early-return branch and would otherwise never see it.
 */
let products: any[];
const purchaseAsync = vi.fn();

vi.mock('./licensingApi', async () => {
  const actual = await vi.importActual<typeof import('./licensingApi')>(
    './licensingApi',
  );
  return {
    ...actual,
    useCatalogPricing: () => ({ data: products, isLoading: false }),
  };
});

vi.mock('../../contexts/SubscriptionContext', () => ({
  useEntitlements: () => ({
    owned: [],
    license: { status: 'active' },
    snapshot: { offers: {}, purchasability: {} },
    offerFor: () => null,
  }),
}));

vi.mock('../marketplace/marketplaceApi', () => ({
  usePurchaseAddOnViaCheckout: () => ({ mutateAsync: purchaseAsync }),
}));

vi.mock('../legal/CheckoutConsent', () => ({
  default: () => null,
  useConsentComplete: () => true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const bundle = {
  code: 'delivery_platforms',
  name: 'Paket Servis Entegrasyonları',
  description: null,
  kind: 'integration',
  billing: 'annual',
  priceCents: 249_900,
  currency: 'TRY',
  creditKind: null,
  creditUnits: null,
  requiresLicense: true,
  sortOrder: 20,
};

beforeEach(() => {
  products = [bundle];
  purchaseAsync.mockReset();
});

describe('CatalogStore — Semt coming-soon row', () => {
  it('renders as the FIRST line of the integration section', () => {
    render(<CatalogStore />);
    const card = screen.getByTestId('semt-coming-soon');
    const list = card.closest('ul')!;
    expect(list.firstElementChild).toBe(card);
  });

  it('still renders when the catalog comes back empty', () => {
    // grouped.size === 0 takes an early return; without a second render site
    // a tenant with a filtered-empty catalog would never learn Semt exists.
    products = [];
    render(<CatalogStore />);
    expect(screen.getByTestId('semt-coming-soon')).toBeInTheDocument();
    expect(screen.getByText('licensing:store.empty')).toBeInTheDocument();
  });

  it('offers no way to buy it', () => {
    render(<CatalogStore />);
    const card = screen.getByTestId('semt-coming-soon');
    expect(within(card).queryByRole('button')).toBeNull();
    expect(within(card).queryByRole('checkbox')).toBeNull();
  });

  it('touches no API and leaves the paid bundle line alone', () => {
    render(<CatalogStore />);
    fireEvent.click(screen.getByTestId('semt-coming-soon'));
    expect(purchaseAsync).not.toHaveBeenCalled();
    // The real, purchasable delivery product is still on the bill.
    expect(document.getElementById('product-delivery_platforms')).not.toBeNull();
  });
});
