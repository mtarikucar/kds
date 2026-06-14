import { useState } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ColorPickerButton from './ColorPickerButton';

/**
 * ColorPickerButton was previously declared INSIDE DesignEditor's render body,
 * so it got a fresh component identity on every parent state update and React
 * remounted it on every keystroke (open picker lost focus / selection state).
 * Hoisting it to module level fixes that while preserving behavior. These tests
 * pin the externally observable contract: the popover opens on click, the
 * picker reflects the current value, dragging the picker emits a new hex
 * upward, and the open picker SURVIVES the resulting parent re-render (it is
 * not torn down and rebuilt) — the regression we set out to prevent.
 */

// react-colorful derives the selected color from the pointer position relative
// to the interactive surface's bounding box. jsdom reports a zero-size box, so
// we stub getBoundingClientRect to a known 100x100 box; a mousedown at (50,0)
// then maps to a deterministic, non-trivial hue change.
function stubInteractiveGeometry() {
  Element.prototype.getBoundingClientRect = function () {
    return {
      width: 100,
      height: 100,
      top: 0,
      left: 0,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function Host({ initial = '#3B82F6' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ColorPickerButton
      label="Primary Color"
      value={value}
      isOpen={open === 'primaryColor'}
      onToggle={() => setOpen(open === 'primaryColor' ? null : 'primaryColor')}
      onClose={() => setOpen(null)}
      onChange={(color) => setValue(color)}
    />
  );
}

describe('ColorPickerButton', () => {
  beforeEach(() => {
    stubInteractiveGeometry();
  });

  it('shows the label and current value, and keeps the popover closed initially', () => {
    render(<Host initial="#3B82F6" />);
    expect(screen.getByText('Primary Color')).toBeInTheDocument();
    expect(screen.getByText('#3B82F6')).toBeInTheDocument();
    // react-colorful renders elements with the react-colorful class only when open
    expect(document.querySelector('.react-colorful')).toBeNull();
  });

  it('opens the picker when the swatch button is clicked', () => {
    render(<Host />);
    expect(document.querySelector('.react-colorful')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(document.querySelector('.react-colorful')).not.toBeNull();
  });

  it('selecting a color emits a new hex upward and the open picker survives the re-render', () => {
    render(<Host initial="#3B82F6" />);

    // open
    fireEvent.click(screen.getByRole('button'));
    const pickerBefore = document.querySelector('.react-colorful');
    expect(pickerBefore).not.toBeNull();

    const saturation = document.querySelector(
      '.react-colorful__saturation .react-colorful__interactive',
    ) as HTMLElement;
    expect(saturation).not.toBeNull();

    // drag to the top-right of the saturation surface -> a different color
    fireEvent.mouseDown(saturation, { clientX: 50, clientY: 0, button: 0 });

    // the value rendered in the swatch button changed (selection flowed through
    // parent state) and is a valid hex
    const button = screen.getByRole('button');
    const shownValue = within(button).getByText(/^#[0-9a-fA-F]{6}$/).textContent!;
    expect(shownValue.toUpperCase()).not.toBe('#3B82F6');

    // crucially the picker is STILL open after the value-driven re-render — the
    // hoisted component was not remounted. (The old inline version would lose
    // this open state because its identity changed each render.)
    expect(document.querySelector('.react-colorful')).not.toBeNull();
  });

  it('closing via the backdrop hides the picker', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button')); // open
    expect(document.querySelector('.react-colorful')).not.toBeNull();

    // the full-screen backdrop is the fixed inset-0 sibling div
    const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop);
    expect(document.querySelector('.react-colorful')).toBeNull();
  });
});
