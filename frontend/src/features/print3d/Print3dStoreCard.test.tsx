import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';

// Print3dStoreCard must NEVER re-derive ₺1.550 / ₺150.000 itself — Görev 8
// made GET /v1/print3d/offer the single source of truth for price. This spec
// proves the rendered price TRACES to that response: `formatWithCurrency` is
// asserted to have been called with the offer's own basePriceCents/100 and
// perItemCents/100 (not a fixed frontend constant), and re-rendering with a
// DIFFERENT offer changes the rendered numbers accordingly. A test that only
// checked "some price is shown" would still pass if the component ignored
// the offer and printed a hardcoded string — this one would not.

const offerState: { data: any } = { data: undefined };
vi.mock('./print3dApi', () => ({
  useGetPrint3dOffer: () => offerState,
}));

const formatWithCurrency = vi.fn((amount: number, currency: string) => `FMT(${amount},${currency})`);
vi.mock('../../hooks/useFormatCurrency', () => ({
  useFormatCurrencyExtended: () => ({
    formatCurrency: (a: number) => String(a),
    formatWithCurrency,
    currency: 'TRY',
  }),
  useFormatCurrency: () => (a: number) => String(a),
}));

import Print3dStoreCard from './Print3dStoreCard';

beforeAll(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
});

function renderCard() {
  return render(
    <MemoryRouter>
      <Print3dStoreCard />
    </MemoryRouter>,
  );
}

describe('Print3dStoreCard', () => {
  beforeEach(() => {
    offerState.data = undefined;
    formatWithCurrency.mockClear();
  });

  it('renders nothing when the offer is unavailable', () => {
    offerState.data = {
      available: false,
      basePriceCents: 150_000,
      perItemCents: 5_000,
      currency: 'TRY',
      minItems: 1,
      maxItems: 50,
      partnerName: 'Figurunica',
      partnerUrl: null,
    };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the offer query has not resolved yet', () => {
    offerState.data = undefined;
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('formats the price from the offer response (150000/5000 cents), not a frontend constant', () => {
    offerState.data = {
      available: true,
      basePriceCents: 150_000,
      perItemCents: 5_000,
      currency: 'TRY',
      minItems: 1,
      maxItems: 50,
      partnerName: 'Figurunica',
      partnerUrl: null,
    };
    renderCard();
    // Cents -> major units is the caller's job (every useFormatCurrency
    // caller in this repo divides by 100 first); asserting the EXACT args
    // proves the numbers are read off the offer, not typed in literally.
    expect(formatWithCurrency).toHaveBeenCalledWith(1500, 'TRY');
    expect(formatWithCurrency).toHaveBeenCalledWith(50, 'TRY');
    expect(screen.getByText(/FMT\(1500,TRY\)/)).toBeInTheDocument();
    expect(screen.getByText(/FMT\(50,TRY\)/)).toBeInTheDocument();
  });

  it('changes the rendered price when the server offer changes — proves it is not hardcoded', () => {
    offerState.data = {
      available: true,
      basePriceCents: 999_900, // a value nowhere close to the real ₺1.550 base
      perItemCents: 12_300,
      currency: 'TRY',
      minItems: 1,
      maxItems: 50,
      partnerName: 'Figurunica',
      partnerUrl: null,
    };
    renderCard();
    expect(formatWithCurrency).toHaveBeenCalledWith(9999, 'TRY');
    expect(formatWithCurrency).toHaveBeenCalledWith(123, 'TRY');
    expect(screen.getByText(/FMT\(9999,TRY\)/)).toBeInTheDocument();
    expect(screen.getByText(/FMT\(123,TRY\)/)).toBeInTheDocument();
    // And the values from the FIRST test's offer must not leak in.
    expect(screen.queryByText(/FMT\(1500,TRY\)/)).toBeNull();
    expect(screen.queryByText(/FMT\(50,TRY\)/)).toBeNull();
  });

  it('links the single card to the wizard route', () => {
    offerState.data = {
      available: true,
      basePriceCents: 150_000,
      perItemCents: 5_000,
      currency: 'TRY',
      minItems: 1,
      maxItems: 50,
      partnerName: 'Figurunica',
      partnerUrl: 'https://figurunica.com',
    };
    renderCard();
    // Two links render here: PartnerBadge's outbound Figurunica link and the
    // card's own CTA — scope by accessible name so this doesn't collide.
    expect(screen.getByRole('link', { name: enHardware.print3d.card.cta })).toHaveAttribute(
      'href',
      '/admin/store/print3d',
    );
  });
});
