import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const countryCodeRef = { value: 'TR' };
vi.mock('../../hooks/useCountryProfile', () => ({
  useCountryProfile: () => ({ countryCode: countryCodeRef.value }),
}));

import PhoneInput from './PhoneInput';

describe('PhoneInput', () => {
  beforeEach(() => {
    countryCodeRef.value = 'TR';
  });

  it('emits canonical E.164 when a natural Turkish number is typed', () => {
    const onChange = vi.fn();
    render(<PhoneInput label="Telefon" value="" onChange={onChange} />);
    const input = screen.getByLabelText('Telefon');
    fireEvent.change(input, { target: { value: '0555 123 45 67' } });
    expect(onChange).toHaveBeenLastCalledWith('+905551234567');
  });

  it('emits empty string while the number is still incomplete', () => {
    const onChange = vi.fn();
    render(<PhoneInput label="Telefon" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Telefon'), { target: { value: '0555' } });
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('seeds the country + national number from an existing E.164 value', () => {
    render(<PhoneInput label="Telefon" value="+905551234567" onChange={() => {}} />);
    const input = screen.getByLabelText('Telefon') as HTMLInputElement;
    // national number visible (formatted), without the country code
    expect(input.value.replace(/\s/g, '')).toContain('5551234567');
    // country selector reflects TR (+90 shown)
    expect(screen.getByText('+90')).toBeInTheDocument();
  });

  it('re-emits E.164 under the newly selected country', () => {
    const onChange = vi.fn();
    render(<PhoneInput label="Telefon" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Telefon'), { target: { value: '202 555 0182' } });
    onChange.mockClear();
    fireEvent.change(screen.getByLabelText('Country code'), { target: { value: 'US' } });
    expect(onChange).toHaveBeenLastCalledWith('+12025550182');
  });

  it('reports validity via onValidityChange', () => {
    const onValidityChange = vi.fn();
    render(<PhoneInput label="Telefon" value="" onChange={() => {}} onValidityChange={onValidityChange} />);
    fireEvent.change(screen.getByLabelText('Telefon'), { target: { value: '0555 123 45 67' } });
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
  });

  // Task 7 / Step 0: the default country comes from the tenant's OWN
  // country profile, not a hardcoded 'TR' — an Uzbek café's customers were
  // seeing +90 preselected on every phone field (OTP, self-pay,
  // reservations) and having to switch it by hand.
  describe('default country from the tenant profile', () => {
    it("defaults to the tenant's country, not Turkey, on a UZ tenant", () => {
      countryCodeRef.value = 'UZ';
      render(<PhoneInput label="Telefon" value="" onChange={() => {}} />);
      expect(screen.getByText('+998')).toBeInTheDocument();
      expect(screen.queryByText('+90')).not.toBeInTheDocument();
    });

    it('still defaults to TR for a Turkish tenant — unchanged', () => {
      countryCodeRef.value = 'TR';
      render(<PhoneInput label="Telefon" value="" onChange={() => {}} />);
      expect(screen.getByText('+90')).toBeInTheDocument();
    });

    it('an explicit defaultCountry prop still wins over the tenant country', () => {
      countryCodeRef.value = 'UZ';
      render(
        <PhoneInput label="Telefon" value="" onChange={() => {}} defaultCountry="US" />,
      );
      expect(screen.getByText('+1')).toBeInTheDocument();
      expect(screen.queryByText('+998')).not.toBeInTheDocument();
    });
  });
});
