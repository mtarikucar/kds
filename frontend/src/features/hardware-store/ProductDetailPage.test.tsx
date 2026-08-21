import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';
import type { HardwareProduct } from './storeApi';
import { useCartStore } from './cartStore';

// ProductDetailPage renders the SKU detail with regulatory-tier CTA branches
// and writes to the shared cart store. We mock the product fetch + quote +
// auth + branches, keep the helpers real, drive the real cart, and stub
// router navigate + toast so we can assert: add-to-cart writes the right line
// (with the buy/rent acquisition), OOS disables the CTA, QUOTE_ONLY shows the
// disclaimer, and a branch-required service blocks add until a branch is set.

const productState: { data?: HardwareProduct; isLoading: boolean; error: unknown } = {
  data: undefined,
  isLoading: false,
  error: null,
};
const navigate = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const branches = [{ id: 'br-1', name: 'Kadıköy' }];

vi.mock('./storeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storeApi')>();
  return {
    ...actual,
    useGetProductBySku: () => productState,
    useRequestQuote: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});
vi.mock('../branches/branchesApi', () => ({
  useListBranches: () => ({ data: branches }),
}));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (sel: any) => sel({ user: { email: 'op@x.com', firstName: 'Op', lastName: 'E' } }),
}));
vi.mock('sonner', () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }));
// The quote form's <PhoneInput> unconditionally calls useCountryProfile()
// (Rules of Hooks — it can't skip the hook just because this page passes an
// explicit defaultCountry="TR"), which needs a QueryClient the rest of this
// suite doesn't set up. Mock at the hook boundary instead.
vi.mock('../../hooks/useCountryProfile', () => ({
  useCountryProfile: () => ({ countryCode: 'TR' }),
}));
// v3.7.0 — the print3d guard tests below route through <Routes>/<Route> with
// a REAL :sku param in the URL (initialEntries=['/admin/store/print3d_base']),
// so useParams can no longer be pinned to a literal 'KDS-15'. `paramsSku` is
// a mutable test-local default that individual tests can override — mirrors
// the `navigate`/`productState` mutable-fixture pattern already used in this
// file — while every pre-existing test keeps its original 'KDS-15' behaviour
// via the beforeEach reset below.
let paramsSku = 'KDS-15';
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useParams: () => ({ sku: paramsSku }),
    useNavigate: () => navigate,
  };
});

import ProductDetailPage from './ProductDetailPage';

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

function renderPage() {
  return render(
    <MemoryRouter>
      <ProductDetailPage />
    </MemoryRouter>,
  );
}

describe('ProductDetailPage', () => {
  beforeEach(() => {
    productState.data = undefined;
    productState.isLoading = false;
    productState.error = null;
    navigate.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    useCartStore.getState().clear();
    paramsSku = 'KDS-15';
  });

  it('shows the loading copy while the product query is pending', () => {
    productState.isLoading = true;
    renderPage();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows the not-found banner + back link on error', () => {
    productState.error = new Error('404');
    renderPage();
    expect(screen.getByText('Product not found or no access.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to store/ })).toBeInTheDocument();
  });

  it('adds a DIRECT_SALE product to the cart (sell), toasts, and navigates back', () => {
    productState.data = makeProduct();
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));

    const lines = useCartStore.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'hardware', acquisition: 'sell', qty: 1 });
    expect(lines[0].product.sku).toBe('KDS-15');
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/admin/store?tab=hardware');
  });

  // Task 11 — rent acquisition is removed from the storefront FOR NOW: PayTR
  // only supports one-time charges, so there is no monthly-billing rail
  // behind "rent" (a buyer who "rented" a device was charged once and never
  // billed again). Even a product that still carries rentalMonthlyCents
  // (legacy data, or a superadmin-entered value ahead of the future billing
  // rail) must never show a way to select rent — the catalog no longer
  // OFFERS it, so the client can never send acquisition:'rent'.
  it('never offers a Buy/Rent toggle, even for a product with rentalMonthlyCents set', () => {
    productState.data = makeProduct({ rentalMonthlyCents: 9000 });
    renderPage();

    expect(screen.queryByRole('button', { name: 'Rent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buy' })).not.toBeInTheDocument();
    expect(screen.queryByText(/rent/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));

    const lines = useCartStore.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'hardware', acquisition: 'sell' });
  });

  it('disables Add to cart and does not write the cart for an out-of-stock product', () => {
    productState.data = makeProduct({ stockStatus: 'out_of_stock' });
    renderPage();

    const btn = screen.getByRole('button', { name: 'Out of stock' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(useCartStore.getState().lines).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the QUOTE_ONLY regulatory disclaimer instead of an add-to-cart CTA', () => {
    productState.data = makeProduct({ saleMode: 'QUOTE_ONLY' });
    renderPage();
    expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument();
    expect(screen.getByText(/doğrudan satışa kapalıdır/)).toBeInTheDocument();
  });

  it('renders an outbound provider link for a PARTNER_REDIRECT product with a safe https url', () => {
    productState.data = makeProduct({
      saleMode: 'PARTNER_REDIRECT',
      partnerRedirect: { partnerName: 'BankX', partnerUrl: 'https://bankx.example/pos' },
    });
    renderPage();
    const link = screen.getByRole('link', { name: /BankX/ });
    expect(link).toHaveAttribute('href', 'https://bankx.example/pos');
    expect(link).toHaveAttribute('target', '_blank');
  });

  // Task 11 — QuoteService prices every line as KDV-INCLUSIVE (gross; see
  // quote.service.ts's netCents/taxCents derivation), but the service detail
  // page used to say "Tek seferlik, KDV hariç" (excl. VAT) right under the
  // price — the opposite of what actually happens at checkout. The copy must
  // read incl.-VAT so it matches the real pricing model.
  it('shows VAT-inclusive copy under a service price (not the old excl.-VAT claim)', () => {
    productState.data = makeProduct({
      category: 'service',
      serviceMeta: { serviceType: 'consultation', requiresBranch: false },
    });
    renderPage();

    expect(screen.getByText('One-time, incl. VAT')).toBeInTheDocument();
    expect(screen.queryByText(/excl\.\s*VAT/i)).not.toBeInTheDocument();
  });

  it('blocks adding a branch-required service until a branch is chosen, then carts it', () => {
    productState.data = makeProduct({
      category: 'service',
      serviceMeta: { serviceType: 'consultation', requiresBranch: true },
    });
    renderPage();

    // branchValid=false -> button disabled, and a direct click errors out.
    const addBtn = screen.getByRole('button', { name: 'Add to cart' });
    expect(addBtn).toBeDisabled();

    // Pick a branch -> button enabled -> add writes a service line.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'br-1' } });
    expect(addBtn).toBeEnabled();
    fireEvent.click(addBtn);

    const lines = useCartStore.getState().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'service', branchId: 'br-1' });
    expect(navigate).toHaveBeenCalledWith('/admin/store?tab=hardware');
  });

  describe('print3d raw-SKU guard (Görev 15)', () => {
    it('redirects a print3d sku to the wizard instead of rendering a buyable service panel', () => {
      paramsSku = 'print3d_base';
      productState.data = {
        ...makeProduct(),
        sku: 'print3d_base',
        category: 'service',
        name: '3D baskı figür — hizmet bedeli',
        serviceMeta: { serviceType: 'print3d', role: 'base' },
      } as any;
      render(
        <MemoryRouter initialEntries={['/admin/store/print3d_base']}>
          <Routes>
            <Route path="/admin/store/:sku" element={<ProductDetailPage />} />
            <Route path="/admin/store/print3d" element={<div>WIZARD</div>} />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.getByText('WIZARD')).toBeTruthy();
      // "Sepete ekle" paneli HİÇ basılmamalı: ham SKU tek başına sepete
      // girerse quote motoru ancak form doldurulduktan SONRA reddeder.
      expect(screen.queryByText(enHardware.common.addToCart)).toBeNull();
    });

    it('never labels a print3d service as Yerinde kurulum', () => {
      paramsSku = 'print3d_item';
      productState.data = {
        ...makeProduct(),
        sku: 'print3d_item',
        category: 'service',
        serviceMeta: { serviceType: 'print3d', role: 'item' },
      } as any;
      const { container } = render(
        <MemoryRouter initialEntries={['/admin/store/print3d_item']}>
          <Routes>
            <Route path="/admin/store/:sku" element={<ProductDetailPage />} />
            <Route path="/admin/store/print3d" element={<div>WIZARD</div>} />
          </Routes>
        </MemoryRouter>,
      );
      // Etiket zinciri bilinmeyen her serviceType'ı 'onsite'e düşürüyordu.
      expect(container.textContent).not.toContain(enHardware.store.service_.onsite);
    });

    it('does not redirect a non-print3d sku (the guard is scoped to the two known SKUs)', () => {
      // Regression guard for the guard itself — asserts isPrint3dSku, not a
      // substring/prefix match, drives the redirect.
      paramsSku = 'print3d-accessory-stand';
      productState.data = makeProduct({ sku: 'print3d-accessory-stand' });
      render(
        <MemoryRouter initialEntries={['/admin/store/print3d-accessory-stand']}>
          <Routes>
            <Route path="/admin/store/:sku" element={<ProductDetailPage />} />
            <Route path="/admin/store/print3d" element={<div>WIZARD</div>} />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.queryByText('WIZARD')).toBeNull();
      expect(screen.getByRole('button', { name: 'Add to cart' })).toBeInTheDocument();
    });
  });
});
