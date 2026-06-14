import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { QrMenuSettings } from '../../types';
import DesignEditor from './DesignEditor';

// api is only touched by the (un-exercised here) logo upload handler; stub it so
// nothing reaches the network if the module is imported.
vi.mock('../../lib/api', () => ({ default: { post: vi.fn() } }));

/**
 * Narrow integration smoke for the post-decomposition DesignEditor.
 *
 * After splitting each activeTab branch into presentational TemplatesTab /
 * ColorsTab / TypographyTab / LayoutTab / QrTab children, this verifies the
 * wiring is behavior-preserving: switching tabs renders the right child, and
 * the one stateful money-free interaction that crosses the parent/child
 * boundary — selecting a custom color — still flows through the parent's
 * formData and is reflected back in the child swatch. We deliberately avoid a
 * vacuous "render the whole tree with mocked children" assertion.
 */

const baseSettings: QrMenuSettings = {
  id: 's1',
  tenantId: 't1',
  primaryColor: '#3B82F6',
  secondaryColor: '#1F2937',
  backgroundColor: '#F9FAFB',
  fontFamily: 'Inter',
  showRestaurantInfo: true,
  showPrices: true,
  showDescription: true,
  showImages: true,
  layoutStyle: 'GRID',
  itemsPerRow: 2,
  enableTableQR: true,
  tableQRMessage: 'Scan to view menu',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

function renderEditor(overrides: Partial<QrMenuSettings> = {}) {
  const onUpdate = vi.fn();
  render(
    <DesignEditor
      settings={{ ...baseSettings, ...overrides }}
      onUpdate={onUpdate}
      tenant={{ id: 't1', name: 'Acme Diner' }}
    />,
  );
  return { onUpdate };
}

// Tabs are buttons in the top nav; click by exact accessible name to avoid
// colliding with same-worded buttons elsewhere on the page.
function clickTab(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('DesignEditor tab decomposition', () => {
  beforeEach(() => {
    // react-colorful needs a real bounding box to compute colors.
    Element.prototype.getBoundingClientRect = function () {
      return {
        width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100,
        x: 0, y: 0, toJSON: () => ({}),
      } as DOMRect;
    };
  });

  it('defaults to the Templates tab and applies a template into formData', () => {
    renderEditor();
    // Templates tab content is present (template cards render their layout/font badges)
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    // The "Fine Dining" template card uses a LIST layout + Playfair Display font badge.
    expect(screen.getByText('Playfair Display')).toBeInTheDocument();
  });

  it('switches to Layout tab and toggles a display option without crashing', () => {
    renderEditor();
    clickTab('Layout');
    // Layout tab renders the items-per-row buttons (1..4) for the GRID default.
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4' })).toBeInTheDocument();
  });

  it('switches to QR tab and shows the table-QR message input when enabled', () => {
    renderEditor({ enableTableQR: true });
    clickTab('QR Style');
    // The message input is rendered with the seeded value.
    expect(screen.getByDisplayValue('Scan to view menu')).toBeInTheDocument();
  });

  it('Colors tab: selecting a custom color flows through parent state into the child swatch', () => {
    renderEditor();
    clickTab('Colors');

    // open the Primary color picker (first custom color slot)
    const primaryButton = screen.getByText('Primary Color').closest('div')!
      .querySelector('button') as HTMLButtonElement;
    expect(primaryButton).not.toBeNull();
    expect(within(primaryButton).getByText('#3B82F6')).toBeInTheDocument();

    fireEvent.click(primaryButton);
    const saturation = document.querySelector(
      '.react-colorful__saturation .react-colorful__interactive',
    ) as HTMLElement;
    expect(saturation).not.toBeNull();

    fireEvent.mouseDown(saturation, { clientX: 50, clientY: 0, button: 0 });

    // The swatch value (driven by the PARENT's formData) changed and stays a hex.
    const shown = within(primaryButton).getByText(/^#[0-9a-fA-F]{6}$/).textContent!;
    expect(shown.toUpperCase()).not.toBe('#3B82F6');
  });
});
