import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PhoneInput from './PhoneInput';

describe('PhoneInput', () => {
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
});
