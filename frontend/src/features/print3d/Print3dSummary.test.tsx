import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';

let consentComplete = true;
vi.mock('../legal/CheckoutConsent', () => ({
  default: () => null,
  useConsentComplete: () => consentComplete,
}));

// Print3dSummary must NOT format money with a hardcoded tr-TR Intl instance
// (hardware-store/storeApi's `formatMoney`) — v3.7.0 made money display
// country-profile-driven, and Görev 14/15/16's implementers already had to
// make this exact correction on Print3dStoreCard / Print3dProductPicker.
// Mocking the hook and asserting on the rendered `FMT(amount,currency)` stub
// text (rather than a hand-computed tr-TR string) proves the totals trace to
// whatever cents value the component was actually given.
const formatWithCurrency = vi.fn((amount: number, currency: string) => `FMT(${amount},${currency})`);
vi.mock('../../hooks/useFormatCurrency', () => ({
  useFormatCurrencyExtended: () => ({
    formatCurrency: (a: number) => String(a),
    formatWithCurrency,
    currency: 'TRY',
  }),
  useFormatCurrency: () => (a: number) => String(a),
}));

import Print3dSummary from './Print3dSummary';

beforeAll(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
});

function renderSummary(over: Partial<Record<string, unknown>> = {}) {
  const onPay = vi.fn();
  render(
    <Print3dSummary
      itemCount={10}
      basePriceCents={150000}
      perItemCents={5000}
      currency="TRY"
      partnerUrl="https://figurunica.com"
      accepted={['a', 'b', 'c']}
      onAcceptedChange={vi.fn()}
      serverTotalCents={200000}
      verifying={false}
      onPay={onPay}
      paying={false}
      {...(over as any)}
    />,
  );
  return { onPay };
}

describe('Print3dSummary', () => {
  it('renders the base line, the per-item line, zero shipping and the total', () => {
    renderSummary();
    expect(screen.getByTestId('print3d-line-base').textContent).toContain('FMT(1500,TRY)');
    expect(screen.getByTestId('print3d-line-items').textContent).toContain('FMT(500,TRY)');
    // Kargo BİLEREK ₺0 — "kargo dahil" vaadi. Satır yine de gösteriliyor.
    expect(screen.getByTestId('print3d-line-shipping').textContent).toContain('FMT(0,TRY)');
    // itemCount=10 makes local arithmetic (150000 + 5000*10 = 200000) equal
    // the server figure here, so this test alone doesn't prove traceability
    // — see the next test for that.
    expect(screen.getByTestId('print3d-total').textContent).toContain('FMT(2000,TRY)');
  });

  it('traces the displayed total to the server response, not to local arithmetic', () => {
    // itemCount/base/perItem never change across the two renders below, so
    // the LOCAL total is pinned at 150000 + 5000*10 = 200000 the whole time.
    // Only `serverTotalCents` changes. If the rendered total were a local
    // recomputation, it would stay at FMT(2000,TRY) after the rerender too.
    const base = {
      itemCount: 10,
      basePriceCents: 150000,
      perItemCents: 5000,
      currency: 'TRY',
      partnerUrl: 'https://figurunica.com',
      accepted: ['a', 'b', 'c'],
      onAcceptedChange: vi.fn(),
      verifying: false,
      onPay: vi.fn(),
      paying: false,
    };
    const { rerender } = render(<Print3dSummary {...base} serverTotalCents={200000} />);
    expect(screen.getByTestId('print3d-total').textContent).toContain('FMT(2000,TRY)');

    rerender(<Print3dSummary {...base} serverTotalCents={305000} />);
    expect(screen.getByTestId('print3d-total').textContent).toContain('FMT(3050,TRY)');
  });

  it('keeps the pay button disabled until all three legal documents are ticked', () => {
    consentComplete = false;
    const { onPay } = renderSummary();
    const btn = screen.getByRole('button', { name: enHardware.print3d.summary.pay });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onPay).not.toHaveBeenCalled();
    consentComplete = true;
  });

  it('keeps the pay button disabled while the server total is still unverified', () => {
    const { onPay } = renderSummary({ serverTotalCents: null, verifying: true });
    const btn = screen.getByRole('button', { name: enHardware.print3d.summary.pay });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onPay).not.toHaveBeenCalled();
    expect(screen.getByText(enHardware.print3d.summary.verifying)).toBeTruthy();
  });

  it('warns and blocks payment when the server total disagrees with the local arithmetic, but still displays the SERVER figure', () => {
    // İstemci aritmetiği ASLA nihai değildir. Ayrışma varsa ödeme açılmaz —
    // ve gösterilen rakam yine sunucununkidir (1990), yerel 2000 değil.
    const { onPay } = renderSummary({ serverTotalCents: 199000 });
    expect(screen.getByTestId('print3d-total').textContent).toContain('FMT(1990,TRY)');
    expect(screen.getByText(enHardware.print3d.summary.mismatch)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: enHardware.print3d.summary.pay }));
    expect(onPay).not.toHaveBeenCalled();
  });

  it('fires onPay once everything checks out', () => {
    const { onPay } = renderSummary();
    fireEvent.click(screen.getByRole('button', { name: enHardware.print3d.summary.pay }));
    expect(onPay).toHaveBeenCalledTimes(1);
  });
});
