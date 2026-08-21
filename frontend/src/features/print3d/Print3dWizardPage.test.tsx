import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';

const offer = {
  data: {
    available: true,
    basePriceCents: 150000,
    perItemCents: 5000,
    currency: 'TRY',
    minItems: 1,
    maxItems: 50,
    partnerName: 'Figurunica',
    partnerUrl: 'https://figurunica.com',
  },
};
const quote = { mutateAsync: vi.fn(), isPending: false };
const intent = { mutateAsync: vi.fn(), isPending: false };
const menuProducts = {
  data: [
    { id: 'p1', name: 'Adana Kebap', price: 100, image: null, images: [], categoryId: 'c1', category: { id: 'c1', name: 'Ana' } },
    { id: 'p2', name: 'Lahmacun', price: 80, image: null, images: [], categoryId: 'c1', category: { id: 'c1', name: 'Ana' } },
  ],
  isLoading: false,
};

vi.mock('./print3dApi', () => ({ useGetPrint3dOffer: () => offer }));
vi.mock('../menu/menuApi', () => ({ useProducts: () => menuProducts }));
vi.mock('../branches/branchesApi', () => ({ useListBranches: () => ({ data: [] }) }));
vi.mock('../hardware-store/storeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hardware-store/storeApi')>();
  return { ...actual, useQuoteCart: () => quote, useCreateCheckoutIntent: () => intent };
});
vi.mock('../hardware-store/checkoutRef', () => ({
  stashPendingCheckoutRef: vi.fn(),
}));
vi.mock('../hardware-store/ShippingAddressForm', () => ({
  default: ({ onSubmit }: { onSubmit: (r: any) => void }) => (
    <button
      data-testid="ship-submit"
      onClick={() =>
        onSubmit({
          address: { recipientName: 'Op', phone: '+90', line1: 'L1', city: 'İstanbul', country: 'Türkiye' },
          branchId: 'br-1',
        })
      }
    >
      ship
    </button>
  ),
}));

let consentComplete = true;
let acceptedIds = ['doc-kvkk', 'doc-sales', 'doc-refund'];
vi.mock('../legal/CheckoutConsent', () => ({
  default: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <button data-testid="tick-consents" onClick={() => onChange(acceptedIds)}>
      consents
    </button>
  ),
  useConsentComplete: () => consentComplete,
}));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (sel: any) =>
    sel({ user: { email: 'op@x.com', firstName: 'Op', lastName: 'E', phone: '+905550000000' } }),
}));

// Print3dWizardPage renders Print3dProductPicker (step 1) and Print3dSummary
// (step 3), both of which format money via useFormatCurrencyExtended
// (country-profile-driven, v3.7.0). That hook chains into
// useGetTenantSettings → useQuery, which throws without a QueryClientProvider
// in the tree. Görev 14/15/16/18's tests all sidestep this by mocking the
// hook outright rather than wrapping every render in a QueryClientProvider —
// this test follows the same established convention.
vi.mock('../../hooks/useFormatCurrency', () => ({
  useFormatCurrencyExtended: () => ({
    formatCurrency: (a: number) => String(a),
    formatWithCurrency: (amount: number, currency: string) => `FMT(${amount},${currency})`,
    currency: 'TRY',
  }),
  useFormatCurrency: () => (a: number) => String(a),
}));

import Print3dWizardPage from './Print3dWizardPage';

beforeAll(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
});

function renderWizard() {
  return render(
    <MemoryRouter>
      <Print3dWizardPage />
    </MemoryRouter>,
  );
}

/** Adım 1 → 2 → 3: iki ürün seç, adresi gönder. */
async function walkToSummary() {
  fireEvent.click(screen.getByTestId('print3d-pick-p1'));
  fireEvent.click(screen.getByTestId('print3d-pick-p2'));
  fireEvent.click(screen.getByText(enHardware.print3d.wizard.next));
  fireEvent.click(await screen.findByTestId('ship-submit'));
  await screen.findByTestId('print3d-total');
}

describe('Print3dWizardPage', () => {
  beforeEach(() => {
    consentComplete = true;
    quote.mutateAsync.mockReset();
    quote.mutateAsync.mockResolvedValue({ totalCents: 160000, shippingCents: 0 });
    intent.mutateAsync.mockReset();
    intent.mutateAsync.mockResolvedValue({
      paymentRef: 'CK-1',
      paymentLink: 'https://paytr.example/pay',
    });
  });

  it('blocks the Next button until at least one product is selected, and unblocks past the min', () => {
    // Görev 16 deliberately left this gate out of Print3dProductPicker (see
    // its own file header comment) — the wizard shell is the piece that
    // must enforce [minItems, maxItems] before letting the buyer past step 1.
    renderWizard();
    const next = screen.getByText(enHardware.print3d.wizard.next).closest('button')!;
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByTestId('print3d-pick-p1'));
    expect(next).not.toBeDisabled();
  });

  it('asks the server for the real total before enabling payment', async () => {
    renderWizard();
    await walkToSummary();
    expect(quote.mutateAsync).toHaveBeenCalledWith({
      items: [
        { type: 'service', code: 'print3d_base', qty: 1, branchId: 'br-1' },
        {
          type: 'service',
          code: 'print3d_item',
          qty: 2,
          branchId: 'br-1',
          productIds: ['p1', 'p2'],
          notes: undefined,
        },
      ],
    });
  });

  it('posts exactly two service lines with productIds and acceptedDocumentIds', async () => {
    renderWizard();
    await walkToSummary();
    fireEvent.click(screen.getByTestId('tick-consents'));
    fireEvent.click(screen.getByRole('button', { name: enHardware.print3d.summary.pay }));
    await waitFor(() => expect(intent.mutateAsync).toHaveBeenCalled());
    const body = intent.mutateAsync.mock.calls[0][0];
    expect(body.cart.items).toHaveLength(2);
    expect(body.cart.items[1]).toMatchObject({
      code: 'print3d_item',
      qty: 2,
      productIds: ['p1', 'p2'],
    });
    expect(body.acceptedDocumentIds).toEqual(['doc-kvkk', 'doc-sales', 'doc-refund']);
    expect(body.branchId).toBe('br-1');
  });

  it('keeps the pay button disabled until all three legal documents are ticked', async () => {
    consentComplete = false;
    renderWizard();
    await walkToSummary();
    const btn = screen.getByRole('button', { name: enHardware.print3d.summary.pay });
    expect(btn).toBeDisabled();
  });

  it('redirects to paymentLink on success', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign, origin: 'https://app.example' },
      writable: true,
    });
    renderWizard();
    await walkToSummary();
    fireEvent.click(screen.getByTestId('tick-consents'));
    fireEvent.click(screen.getByRole('button', { name: enHardware.print3d.summary.pay }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://paytr.example/pay'));
  });

  it('shows the unavailable copy and no picker when the offer is closed', () => {
    offer.data = { ...offer.data, available: false };
    renderWizard();
    expect(screen.getByText(enHardware.print3d.wizard.unavailable)).toBeTruthy();
    expect(screen.queryByTestId('print3d-pick-p1')).toBeNull();
    offer.data = { ...offer.data, available: true };
  });
});
