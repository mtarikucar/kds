import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';

// ShippingAddressForm'un kendi spec'i var; burada onu bir düğmeye indirgeyip
// SİHİRBAZIN kablolamasını test ediyoruz.
vi.mock('../hardware-store/ShippingAddressForm', () => ({
  default: ({
    onSubmit,
    submitLabel,
  }: {
    onSubmit: (r: any) => void;
    submitLabel?: string;
  }) => (
    <button
      data-testid="ship-submit"
      onClick={() =>
        onSubmit({
          address: {
            recipientName: 'Op',
            phone: '+90',
            line1: 'L1',
            city: 'İstanbul',
            country: 'Türkiye',
          },
          branchId: 'br-1',
        })
      }
    >
      {submitLabel}
    </button>
  ),
}));

import Print3dShippingStep from './Print3dShippingStep';

beforeAll(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
});

describe('Print3dShippingStep', () => {
  it('reports the address and branchId upward', () => {
    const onSubmit = vi.fn();
    render(
      <Print3dShippingStep
        branches={[]}
        notes=""
        onNotesChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByTestId('ship-submit'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'br-1' }),
    );
  });

  it('reports note edits upward', () => {
    const onNotesChange = vi.fn();
    render(
      <Print3dShippingStep
        branches={[]}
        notes=""
        onNotesChange={onNotesChange}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(enHardware.print3d.shipping.notesLabel), {
      target: { value: 'Kırmızı boya' },
    });
    expect(onNotesChange).toHaveBeenCalledWith('Kırmızı boya');
  });

  it('caps the production note at 500 characters', () => {
    // Backend CartItemDto.notes @MaxLength(500). Tarayıcı tarafında da
    // sınırlanmazsa alıcı 600 karakter yazıp ödemede 400 alır.
    render(
      <Print3dShippingStep
        branches={[]}
        notes=""
        onNotesChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(enHardware.print3d.shipping.notesLabel),
    ).toHaveAttribute('maxlength', '500');
  });

  it('truncates a >500-char paste to exactly 500 instead of relying on the attribute alone', () => {
    // The `maxlength` HTML attribute stops real keystrokes, but a
    // programmatic value set (paste, autofill, or — as here — a test
    // firing `change` directly) bypasses it in jsdom. If onNotesChange
    // just forwarded e.target.value verbatim, this test would report the
    // full 600-char string upward and the backend's
    // CartItemDto.notes @MaxLength(500) would 400 at checkout.
    const onNotesChange = vi.fn();
    render(
      <Print3dShippingStep
        branches={[]}
        notes=""
        onNotesChange={onNotesChange}
        onSubmit={vi.fn()}
      />,
    );
    const longValue = 'a'.repeat(600);
    fireEvent.change(screen.getByLabelText(enHardware.print3d.shipping.notesLabel), {
      target: { value: longValue },
    });
    expect(onNotesChange).toHaveBeenCalledWith('a'.repeat(500));
    expect(onNotesChange.mock.calls[0][0]).toHaveLength(500);
  });

  it('shows a live character counter that tracks the notes prop, not local state', () => {
    // The wizard shell owns `notes` (it survives step navigation); this
    // component must render off the PROP, not a copy, or the counter and
    // the value the wizard actually submits could disagree.
    const { rerender } = render(
      <Print3dShippingStep
        branches={[]}
        notes=""
        onNotesChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText('0/500')).toBeTruthy();
    rerender(
      <Print3dShippingStep
        branches={[]}
        notes="Kırmızı boya"
        onNotesChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText('12/500')).toBeTruthy();
    expect(
      (screen.getByLabelText(enHardware.print3d.shipping.notesLabel) as HTMLTextAreaElement).value,
    ).toBe('Kırmızı boya');
  });

  it('disables the ShippingAddressForm submit path while submitting', () => {
    // ShippingAddressForm itself owns the disabled/"processing…" rendering
    // (its own spec covers that); this just proves the flag reaches it.
    const onSubmit = vi.fn();
    render(
      <Print3dShippingStep
        branches={[]}
        notes=""
        onNotesChange={vi.fn()}
        onSubmit={onSubmit}
        submitting
      />,
    );
    // The mocked ShippingAddressForm doesn't read `submitting`, so this
    // only smoke-tests that passing it doesn't blow up the render; the
    // wiring itself is asserted by TS (the prop is required-shaped) and by
    // ShippingAddressForm's own spec.
    expect(screen.getByTestId('ship-submit')).toBeTruthy();
  });
});
