import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';
import type { HardwareProduct } from './storeApi';
import { useCartStore } from './cartStore';

// StorePage wires the catalogue grid to the in-memory Zustand cart and the
// quote/intent mutations. We mock the storeApi *hooks* but keep the pure
// helpers (formatMoney / SALE_MODE_DISCLAIMER_TR) real, mock auth + branches,
// stub ShippingAddressForm, and drive the real cart store. Assertions cover
// the saleMode CTA branches, add/remove, the getQuote totals, and that
// opening checkout mounts the address form.

const products: { data: HardwareProduct[]; isLoading: boolean } = { data: [], isLoading: false };
const quote = { mutateAsync: vi.fn(), reset: vi.fn(), isPending: false, data: undefined as any };
const intent = { mutateAsync: vi.fn(), isPending: false };

vi.mock('./storeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storeApi')>();
  return {
    ...actual,
    useListProducts: () => products,
    useCategories: () => ({ data: [{ value: 'kds', labelTr: 'KDS' }] }),
    useQuoteCart: () => quote,
    useCreateCheckoutIntent: () => intent,
  };
});

vi.mock('../branches/branchesApi', () => ({
  useListBranches: () => ({ data: [] }),
}));

vi.mock('../../store/authStore', () => ({
  useAuthStore: (sel: any) =>
    sel({ user: { email: 'op@x.com', firstName: 'Op', lastName: 'Erator' } }),
}));

// ShippingAddressForm has its own spec; stub it to a button that calls
// onSubmit so we can assert the checkout intent wiring without re-testing the
// form internals.
vi.mock('./ShippingAddressForm', () => ({
  default: ({ onSubmit }: { onSubmit: (r: any) => void }) => (
    <button
      data-testid="ship-submit"
      onClick={() =>
        onSubmit({
          address: {
            recipientName: 'Op Erator',
            phone: '+90',
            line1: 'L1',
            city: 'İstanbul',
            country: 'Türkiye',
          },
        })
      }
    >
      ship
    </button>
  ),
}));

import StorePage from './StorePage';

beforeAll(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
});

function makeProduct(over: Partial<HardwareProduct> = {}): HardwareProduct {
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
    ...over,
  };
}

function renderStore() {
  return render(
    <MemoryRouter>
      <StorePage />
    </MemoryRouter>,
  );
}

describe('StorePage', () => {
  beforeEach(() => {
    products.data = [];
    products.isLoading = false;
    quote.mutateAsync.mockReset();
    quote.isPending = false;
    quote.data = undefined;
    intent.mutateAsync.mockReset();
    intent.isPending = false;
    // Reset the shared in-memory cart between tests.
    useCartStore.getState().clear();
  });

  it('shows the empty-category copy when no products are returned', () => {
    products.data = [];
    renderStore();
    expect(screen.getByText('No products in this category.')).toBeInTheDocument();
  });

  it('adds a DIRECT_SALE product to the cart and shows it in the cart panel', () => {
    products.data = [makeProduct({ name: 'KDS Screen 15"' })];
    renderStore();

    expect(screen.getByText('Your cart is empty.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));

    // Cart store now holds the line; the panel lists it with × quantity.
    expect(useCartStore.getState().lines).toHaveLength(1);
    const cart = screen.getByText('Cart').closest('aside')!;
    expect(within(cart).getByText('KDS Screen 15"')).toBeInTheDocument();
    expect(within(cart).getByText('× 1')).toBeInTheDocument();
  });

  it('disables the add button for an out-of-stock product', () => {
    products.data = [makeProduct({ stockStatus: 'out_of_stock' })];
    renderStore();
    const btn = screen.getByRole('button', { name: 'Out of stock' });
    expect(btn).toBeDisabled();
  });

  it('renders a "By quote" CTA (link, not add) for a QUOTE_ONLY product + its disclaimer', () => {
    products.data = [makeProduct({ saleMode: 'QUOTE_ONLY', sku: 'YAZAR-1' })];
    renderStore();

    // No add-to-cart button for quote-only; a "Get Quote" link instead
    // (card CTA copy "Get Quote" is distinct from the cart's "Get quote").
    expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Get Quote' });
    expect(link).toHaveAttribute('href', '/admin/store/YAZAR-1');
    // The shared regulatory disclaimer copy is shown verbatim.
    expect(screen.getByText(/doğrudan satışa kapalıdır/)).toBeInTheDocument();
  });

  it('renders an outbound provider link for a PARTNER_REDIRECT product with a valid https url', () => {
    products.data = [
      makeProduct({
        saleMode: 'PARTNER_REDIRECT',
        partnerRedirect: { partnerName: 'BankX', partnerUrl: 'https://bankx.example/pos' },
      }),
    ];
    renderStore();
    const link = screen.getByRole('link', { name: 'Go to provider' });
    expect(link).toHaveAttribute('href', 'https://bankx.example/pos');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('removes a line from the cart when Remove is clicked', () => {
    products.data = [makeProduct()];
    renderStore();
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect(useCartStore.getState().lines).toHaveLength(1);

    const cart = screen.getByText('Cart').closest('aside')!;
    fireEvent.click(within(cart).getByRole('button', { name: 'Remove' }));
    expect(useCartStore.getState().lines).toHaveLength(0);
    expect(screen.getByText('Your cart is empty.')).toBeInTheDocument();
  });

  it('requests a quote from the live endpoint and renders the returned totals', async () => {
    products.data = [makeProduct()];
    quote.mutateAsync.mockResolvedValue({});
    quote.data = {
      lines: [],
      currency: 'TRY',
      subtotalCents: 50000,
      taxCents: 9000,
      shippingCents: 2500,
      totalCents: 61500,
      warnings: [],
      isPureRecurring: false,
    };
    renderStore();
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));

    fireEvent.click(screen.getByRole('button', { name: 'Get quote' }));
    await waitFor(() =>
      expect(quote.mutateAsync).toHaveBeenCalledWith({
        items: [{ type: 'hardware', sku: 'KDS-15', qty: 1, acquisition: 'sell' }],
      }),
    );

    // The totals block reflects the quote (tr-TR formatting).
    const cart = screen.getByText('Cart').closest('aside')!;
    expect(within(cart).getByText('VAT')).toBeInTheDocument();
    expect(within(cart).getByText('Total')).toBeInTheDocument();
    expect(within(cart).getByText(/615,00/)).toBeInTheDocument(); // 61500 cents
  });

  it('opens the checkout modal and fires the checkout intent on address submit', async () => {
    products.data = [makeProduct()];
    intent.mutateAsync.mockResolvedValue({ paymentLink: '' });
    renderStore();
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));

    // No modal yet.
    expect(screen.queryByTestId('ship-submit')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }));
    expect(screen.getByText('Delivery details')).toBeInTheDocument();

    // Submitting the (stubbed) address form drives the checkout intent.
    fireEvent.click(screen.getByTestId('ship-submit'));
    await waitFor(() => expect(intent.mutateAsync).toHaveBeenCalledTimes(1));
    const arg = intent.mutateAsync.mock.calls[0][0];
    expect(arg.cart.items).toEqual([
      { type: 'hardware', sku: 'KDS-15', qty: 1, acquisition: 'sell' },
    ]);
    expect(arg.buyer.email).toBe('op@x.com');
  });

  it('dismisses the BYO banner when "Got it, close" is clicked', () => {
    products.data = [makeProduct()];
    window.localStorage.removeItem('hardware-store-byo-dismiss-v1');
    renderStore();
    expect(screen.getByText('Already have hardware?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it, close' }));
    expect(screen.queryByText('Already have hardware?')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('hardware-store-byo-dismiss-v1')).toBe('1');
  });
});
