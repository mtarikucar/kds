import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ShippingAddressForm from './ShippingAddressForm';

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
 */
describe('ShippingAddressForm (v2.8.84)', () => {
  function fillRequired(values: Partial<Record<string, string>> = {}) {
    fireEvent.input(screen.getByLabelText(/Alıcı adı/), {
      target: { value: values.recipientName ?? 'Mehmet Mağaza' },
    });
    fireEvent.input(screen.getByLabelText(/^Telefon/), {
      target: { value: values.phone ?? '+90 555 123 45 67' },
    });
    fireEvent.input(screen.getByLabelText(/^Adres satırı 1/), {
      target: { value: values.line1 ?? 'Atatürk Cad. 12' },
    });
    fireEvent.input(screen.getByLabelText(/^Şehir/), {
      target: { value: values.city ?? 'İstanbul' },
    });
  }

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
      recipientName: 'Mehmet Mağaza',
      phone: '+90 555 123 45 67',
      line1: 'Atatürk Cad. 12',
      line2: 'Kat 3 Daire 5',
      district: 'Kadıköy',
      city: 'İstanbul',
      postalCode: '34710',
      country: 'Türkiye',
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
    expect(submitted.line2).toBeUndefined();
    expect(submitted.district).toBeUndefined();
    expect(submitted.postalCode).toBeUndefined();
    expect(submitted.country).toBe('Türkiye'); // default
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
});
