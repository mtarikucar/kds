import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import ShippingAddressForm from './ShippingAddressForm';
import type { Branch } from '../branches/branchesApi';
import trHardware from '../../i18n/locales/tr/hardware.json';
import enHardware from '../../i18n/locales/en/hardware.json';

// This form is Turkish-canonical: the backend formatAddress contract and
// every assertion below reads the Turkish field labels / validation copy.
// The shared test setup boots i18next in `en` with a small namespace
// allow-list, so we register the `hardware` namespace and switch to `tr`
// here to render the form in its canonical locale.
beforeAll(async () => {
  i18next.addResourceBundle('tr', 'hardware', trHardware, true, true);
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
  await i18next.changeLanguage('tr');
});

/**
 * v2.8.84 — shipping address form regression.
 *
 * Backend's `CheckoutNotificationsService.formatAddress` (v2.8.86) reads
 * (recipientName, line1, line2, district, city, postalCode, country,
 * phone) — these field names need to round-trip exactly.
 *
 * Validation is intentionally lenient: Turkish addresses use a mix of
 * Latin and Turkish characters and punctuation that an overly strict
 * regex would lock out.
 *
 * v2.8.99.3 — onSubmit now receives `{address, branchId?}` so the
 * caller can fold branchId into the top-level checkout intent
 * payload. Pre-v2.8.99.3 callers that passed a bare ShippingAddress
 * read `.address` from the wrapper.
 */
describe('ShippingAddressForm (v2.8.84 + v2.8.99.3)', () => {
  function fillRequired(values: Partial<Record<string, string>> = {}) {
    fireEvent.input(screen.getByLabelText(/Alıcı adı/), {
      target: { value: values.recipientName ?? 'Mehmet Mağaza' },
    });
    fireEvent.input(screen.getByLabelText(/^Telefon/), {
      target: { value: values.phone ?? '+90 555 123 45 67' },
    });
    // The line1/city inputs only exist in custom mode; the helper is
    // also used by branch-mode tests where these fields are omitted by
    // the snapshot card.
    const line1 = screen.queryByLabelText(/^Adres satırı 1/);
    const city = screen.queryByLabelText(/^Şehir/);
    if (line1) {
      fireEvent.input(line1, { target: { value: values.line1 ?? 'Atatürk Cad. 12' } });
    }
    if (city) {
      fireEvent.input(city, { target: { value: values.city ?? 'İstanbul' } });
    }
  }

  // ──────────────────────── v2.8.84 regression set ────────────────────────

  it('submits a cleaned ShippingAddress matching the backend formatAddress contract', async () => {
    const onSubmit = vi.fn();
    render(<ShippingAddressForm onSubmit={onSubmit} />);

    fillRequired();
    fireEvent.input(screen.getByLabelText(/Adres satırı 2/), {
      target: { value: 'Kat 3 Daire 5' },
    });
    fireEvent.input(screen.getByLabelText(/İlçe/), {
      target: { value: 'Kadıköy' },
    });
    fireEvent.input(screen.getByLabelText(/Posta kodu/), {
      target: { value: '34710' },
    });

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith({
      address: {
        recipientName: 'Mehmet Mağaza',
        phone: '+90 555 123 45 67',
        line1: 'Atatürk Cad. 12',
        line2: 'Kat 3 Daire 5',
        district: 'Kadıköy',
        city: 'İstanbul',
        postalCode: '34710',
        country: 'Türkiye',
      },
    });
  });

  it('strips empty optional strings before handing back (no "" in the JSON column)', async () => {
    const onSubmit = vi.fn();
    render(<ShippingAddressForm onSubmit={onSubmit} />);

    // Only required fields filled; line2/district/postalCode untouched.
    fillRequired();

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.address.line2).toBeUndefined();
    expect(submitted.address.district).toBeUndefined();
    expect(submitted.address.postalCode).toBeUndefined();
    expect(submitted.address.country).toBe('Türkiye'); // default
    expect(submitted.branchId).toBeUndefined();
  });

  it('rejects clearly non-phone input (HTML / emoji / scripts) but allows TR + formats', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<ShippingAddressForm onSubmit={onSubmit} />);

    // Try a bad phone first.
    fillRequired({ phone: '<script>' });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(
        screen.getByText(/Telefon numarası rakam, boşluk, \+, -, \( \) içerebilir/),
      ).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();

    // Now a good one, in a different format.
    rerender(<ShippingAddressForm onSubmit={onSubmit} />);
    fillRequired({ phone: '(0212) 555 12 34' });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  it('refuses obviously-short required fields with a visible error', async () => {
    const onSubmit = vi.fn();
    render(<ShippingAddressForm onSubmit={onSubmit} />);
    fillRequired({ recipientName: 'X', line1: 'aa', city: 'X' });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(screen.getByText(/Alıcı adı en az 2 karakter/)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prefills from initial when provided (re-open after cart edit must not lose typing)', () => {
    render(
      <ShippingAddressForm
        onSubmit={vi.fn()}
        initial={{
          recipientName: 'Saved Recipient',
          phone: '+905001234567',
          line1: 'Saved line 1',
          city: 'Bursa',
          country: 'Türkiye',
        }}
      />,
    );
    expect(screen.getByLabelText(/Alıcı adı/)).toHaveValue('Saved Recipient');
    expect(screen.getByLabelText(/^Telefon/)).toHaveValue('+905001234567');
    expect(screen.getByLabelText(/^Adres satırı 1/)).toHaveValue('Saved line 1');
    expect(screen.getByLabelText(/^Şehir/)).toHaveValue('Bursa');
  });

  // ──────────────────────── v2.8.99.3 branch mode ────────────────────────

  function makeBranch(over: Partial<Branch> = {}): Branch {
    return {
      id: 'branch-istanbul',
      tenantId: 't-1',
      name: 'Kadıköy Şubesi',
      code: 'IST-01',
      timezone: 'Europe/Istanbul',
      address: {
        line1: 'Atatürk Cad. 12',
        line2: 'Kat 3',
        district: 'Kadıköy',
        city: 'İstanbul',
        postalCode: '34710',
        country: 'Türkiye',
      },
      status: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      ...over,
    };
  }

  it('hides the mode toggle when there are no active branches (legacy custom-only behaviour preserved)', () => {
    render(<ShippingAddressForm onSubmit={vi.fn()} branches={[]} />);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Adres satırı 1/)).toBeInTheDocument();
  });

  it('defaults to branch mode with 1 active branch, renders address preview, no dropdown', async () => {
    const onSubmit = vi.fn();
    const branch = makeBranch();
    render(<ShippingAddressForm onSubmit={onSubmit} branches={[branch]} />);

    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument(); // 1 branch → no dropdown
    expect(screen.getByTestId('branch-address-preview')).toHaveTextContent(/Atatürk Cad\. 12/);
    expect(screen.getByTestId('branch-address-preview')).toHaveTextContent(/Kadıköy Şubesi/);

    // Branch mode doesn't render the address inputs.
    expect(screen.queryByLabelText(/^Adres satırı 1/)).not.toBeInTheDocument();

    // recipientName + phone are still required, even in branch mode.
    fillRequired();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith({
      address: {
        recipientName: 'Mehmet Mağaza',
        phone: '+90 555 123 45 67',
        line1: 'Atatürk Cad. 12',
        line2: 'Kat 3',
        district: 'Kadıköy',
        city: 'İstanbul',
        postalCode: '34710',
        country: 'Türkiye',
      },
      branchId: 'branch-istanbul',
    });
  });

  it('renders a branch dropdown with multiple active branches and updates preview + submit on change', async () => {
    const onSubmit = vi.fn();
    const branches: Branch[] = [
      makeBranch({ id: 'branch-istanbul', name: 'İstanbul Şube' }),
      makeBranch({
        id: 'branch-ankara',
        name: 'Ankara Şube',
        address: {
          line1: 'Tunalı Hilmi Cad. 88',
          city: 'Ankara',
          country: 'Türkiye',
        },
      }),
    ];
    render(<ShippingAddressForm onSubmit={onSubmit} branches={branches} />);

    const select = screen.getByLabelText(/Şube seçin/) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    // Option labels: {name} — {address.line1}
    expect(select.options[0].textContent).toMatch(/İstanbul Şube\s+—\s+Atatürk Cad\. 12/);
    expect(select.options[1].textContent).toMatch(/Ankara Şube\s+—\s+Tunalı Hilmi Cad\. 88/);

    // Switch to Ankara.
    fireEvent.change(select, { target: { value: 'branch-ankara' } });
    expect(screen.getByTestId('branch-address-preview')).toHaveTextContent(/Tunalı Hilmi Cad\. 88/);

    fillRequired();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId: 'branch-ankara',
        address: expect.objectContaining({
          line1: 'Tunalı Hilmi Cad. 88',
          city: 'Ankara',
        }),
      }),
    );
  });

  it('archived/suspended branches are filtered out — mode defaults to custom when only inactive branches remain', () => {
    const branches: Branch[] = [
      makeBranch({ id: 'b-1', status: 'archived' }),
      makeBranch({ id: 'b-2', status: 'suspended' }),
    ];
    render(<ShippingAddressForm onSubmit={vi.fn()} branches={branches} />);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Adres satırı 1/)).toBeInTheDocument();
  });

  it('switching from branch → custom restores the manual address inputs', async () => {
    const onSubmit = vi.fn();
    render(<ShippingAddressForm onSubmit={onSubmit} branches={[makeBranch()]} />);

    // Default branch mode: address inputs are NOT rendered.
    expect(screen.queryByLabelText(/^Adres satırı 1/)).not.toBeInTheDocument();

    // Switch to custom.
    fireEvent.click(screen.getByRole('radio', { name: /Yeni adres/ }));
    expect(screen.getByLabelText(/^Adres satırı 1/)).toBeInTheDocument();

    fillRequired({ line1: 'Manuel Cad. 42', city: 'Bursa' });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith({
      address: expect.objectContaining({
        line1: 'Manuel Cad. 42',
        city: 'Bursa',
      }),
      // No branchId in custom mode.
    });
    expect(onSubmit.mock.calls[0][0].branchId).toBeUndefined();
  });
});
