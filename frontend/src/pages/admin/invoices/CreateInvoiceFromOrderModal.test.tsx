import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * customerTaxId used to be validated against a fixed VKN(10)/TCKN(11)
 * pattern (TAX_ID_RE) — before this, a UZ tenant's own STIR(9)/PINFL(14)
 * was rejected no matter what was typed, disabling the submit button
 * forever for that order.
 */
const { TR_TAX_ID_RULES, UZ_TAX_ID_RULES } = vi.hoisted(() => ({
  TR_TAX_ID_RULES: [
    { name: 'VKN', pattern: '^\\d{10}$', labelKey: 'country.taxId.vkn' },
    { name: 'TCKN', pattern: '^\\d{11}$', labelKey: 'country.taxId.tckn' },
  ],
  UZ_TAX_ID_RULES: [
    { name: 'STIR', pattern: '^\\d{9}$', labelKey: 'country.taxId.stir' },
    { name: 'PINFL', pattern: '^\\d{14}$', labelKey: 'country.taxId.pinfl' },
  ],
}));

const h = vi.hoisted(() => ({
  orders: {
    data: [
      {
        id: 'o1',
        orderNumber: '1001',
        customerName: 'Alice',
        createdAt: '2026-01-01T10:00:00Z',
        finalAmount: '100',
      },
    ] as any[],
    isLoading: false,
    isError: false,
  },
  createInvoice: { mutateAsync: vi.fn(), isPending: false },
  countryProfile: {
    countryCode: 'TR',
    taxRates: [0, 1, 10, 20],
    defaultTaxRate: 10,
    taxIdRules: TR_TAX_ID_RULES,
  },
}));

vi.mock('../../../features/orders/ordersApi', () => ({
  useOrders: () => h.orders,
}));
vi.mock('../../../features/accounting/accountingApi', () => ({
  useCreateInvoiceFromOrder: () => h.createInvoice,
}));
vi.mock('../../../hooks/useCountryProfile', () => ({
  useCountryProfile: () => h.countryProfile,
  isValidTaxId: (value: string, rules: { pattern: string }[]) =>
    typeof value === 'string' && value.length > 0 && rules.some((r) => new RegExp(r.pattern).test(value)),
  taxIdMaxLength: (rules: { pattern: string }[]) => {
    const lens = rules.map((r) => Number(r.pattern.match(/\{(\d+)\}/)?.[1] ?? 0));
    const max = lens.length ? Math.max(...lens) : 0;
    return max > 0 ? max : 20;
  },
}));
vi.mock('../../../hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `₺${n}`,
}));
vi.mock('../../../hooks/useFormatDate', () => ({
  useFormatDate: () => ({ formatDateIntl: (d: string) => d }),
}));
// getApiErrorMessage (via the catch block) imports i18n/config, which would
// eagerly init i18next with all namespaces and make the key-based
// assertions below resolve to real English copy instead of the raw key —
// same trap documented in BrandingSettingsPage.test.tsx / AccountingSettingsPage.test.tsx.
vi.mock('../../../i18n/config', () => ({ default: { t: (k: string) => k } }));

import CreateInvoiceFromOrderModal from './CreateInvoiceFromOrderModal';

beforeEach(() => {
  h.countryProfile = {
    countryCode: 'TR',
    taxRates: [0, 1, 10, 20],
    defaultTaxRate: 10,
    taxIdRules: TR_TAX_ID_RULES,
  };
  h.createInvoice.mutateAsync.mockReset();
});

function getTaxIdInput(): HTMLInputElement {
  const input = document.querySelector('input[inputmode="numeric"]');
  if (!input) throw new Error('customerTaxId input not found');
  return input as HTMLInputElement;
}

describe('CreateInvoiceFromOrderModal — customerTaxId is country-scoped', () => {
  it('does not constrain the input with a fixed HTML pattern', () => {
    render(<CreateInvoiceFromOrderModal onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(getTaxIdInput()).not.toHaveAttribute('pattern');
  });

  it('sizes maxLength to the TR profile (11, from TCKN)', () => {
    render(<CreateInvoiceFromOrderModal onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(getTaxIdInput().maxLength).toBe(11);
  });

  it('accepts a 10-digit VKN under a TR tenant (submit enabled)', () => {
    render(<CreateInvoiceFromOrderModal onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText(/1001/));
    fireEvent.change(getTaxIdInput(), { target: { value: '1234567890' } });
    expect(screen.getByText('accounting.createInvoiceModal.submit').closest('button')).not.toBeDisabled();
  });

  it('rejects a 9-digit value under a TR tenant (submit disabled, inline error)', () => {
    render(<CreateInvoiceFromOrderModal onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText(/1001/));
    fireEvent.change(getTaxIdInput(), { target: { value: '123456789' } });
    expect(screen.getByText(/accounting\.taxIdError/)).toBeInTheDocument();
    expect(screen.getByText('accounting.createInvoiceModal.submit').closest('button')).toBeDisabled();
  });

  describe('under a UZ tenant', () => {
    beforeEach(() => {
      h.countryProfile = {
        countryCode: 'UZ',
        taxRates: [0, 6, 12],
        defaultTaxRate: 12,
        taxIdRules: UZ_TAX_ID_RULES,
      };
    });

    it('widens maxLength to 14 (PINFL)', () => {
      render(<CreateInvoiceFromOrderModal onClose={vi.fn()} onCreated={vi.fn()} />);
      expect(getTaxIdInput().maxLength).toBe(14);
    });

    it('ACCEPTS a 9-digit STIR (submit enabled) — impossible before this task', () => {
      render(<CreateInvoiceFromOrderModal onClose={vi.fn()} onCreated={vi.fn()} />);
      fireEvent.click(screen.getByText(/1001/));
      fireEvent.change(getTaxIdInput(), { target: { value: '123456789' } });
      expect(screen.getByText('accounting.createInvoiceModal.submit').closest('button')).not.toBeDisabled();
    });

    it('rejects the Turkish 10-digit shape (submit disabled)', () => {
      render(<CreateInvoiceFromOrderModal onClose={vi.fn()} onCreated={vi.fn()} />);
      fireEvent.click(screen.getByText(/1001/));
      fireEvent.change(getTaxIdInput(), { target: { value: '1234567890' } });
      expect(screen.getByText('accounting.createInvoiceModal.submit').closest('button')).toBeDisabled();
    });

    it('submits the 9-digit STIR to the mutation', () => {
      render(<CreateInvoiceFromOrderModal onClose={vi.fn()} onCreated={vi.fn()} />);
      fireEvent.click(screen.getByText(/1001/));
      fireEvent.change(getTaxIdInput(), { target: { value: '123456789' } });
      fireEvent.click(screen.getByText('accounting.createInvoiceModal.submit'));
      expect(h.createInvoice.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'o1', customerTaxId: '123456789' }),
      );
    });
  });
});
