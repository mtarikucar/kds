import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { QrCodeData } from '../../types';
import QrCodeDisplay from './QrCodeDisplay';

/**
 * fake-working-sweep-3 M12/M13 regression. The operator-configured
 * `tableQRMessage` (QrMenuSettings) was saved but never rendered — every
 * QR caption hardcoded t('admin.scanToViewMenu'). QrCodeDisplay now takes
 * a `caption` prop and prefers it, falling back to the translated default
 * for empty/legacy rows. These pin the on-screen caption render.
 *
 * (The print path injects the same resolved caption into the print-window
 * HTML; that branch opens a window and is exercised indirectly here via
 * the shared resolution — the on-screen <p> is the inspectable surface.)
 */

const qrCode: QrCodeData = {
  id: 'tab-1',
  type: 'TABLE',
  url: 'https://example.com/qr-menu/t1?tableId=tab-1',
  qrDataUrl: '',
  label: 'Table 1',
};

const tenant = { id: 't1', name: 'Acme Diner' };

describe('QrCodeDisplay caption', () => {
  it('renders the operator-configured caption when provided', () => {
    render(
      <QrCodeDisplay
        qrCode={qrCode}
        tenant={tenant}
        caption="Masamıza hoş geldiniz — menü için tarayın"
      />,
    );
    expect(
      screen.getByText('Masamıza hoş geldiniz — menü için tarayın'),
    ).toBeInTheDocument();
    // The hardcoded default must NOT also render.
    expect(screen.queryByText('Scan to view our menu')).not.toBeInTheDocument();
  });

  it('falls back to the translated default when caption is missing', () => {
    render(<QrCodeDisplay qrCode={qrCode} tenant={tenant} />);
    expect(screen.getByText('Scan to view our menu')).toBeInTheDocument();
  });

  it('falls back to the default when caption is empty/whitespace (legacy rows)', () => {
    render(<QrCodeDisplay qrCode={qrCode} tenant={tenant} caption="   " />);
    expect(screen.getByText('Scan to view our menu')).toBeInTheDocument();
  });
});

/**
 * Two-pane QR page redesign: the full (hero) variant drops the size-preset
 * and format selector grids plus the pro-tips box in favor of one Download
 * button with a PNG/SVG/PDF dropdown. Downloads always export print quality,
 * so a size choice is no longer part of the operator flow.
 */
describe('QrCodeDisplay hero variant (redesign)', () => {
  it('renders one download dropdown instead of size/format selector grids', () => {
    render(<QrCodeDisplay qrCode={qrCode} tenant={tenant} />);

    expect(screen.queryByText('Preview Size')).not.toBeInTheDocument();
    expect(screen.queryByText('Table Tent')).not.toBeInTheDocument();
    expect(screen.queryByText('Download Format')).not.toBeInTheDocument();
    expect(screen.queryByText('Pro Tips')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Download$/ }));
    expect(screen.getByText('Download PNG')).toBeInTheDocument();
    expect(screen.getByText('Download SVG')).toBeInTheDocument();
    expect(screen.getByText('Download PDF')).toBeInTheDocument();
  });

  it('still shows the menu URL with a copy action', () => {
    render(<QrCodeDisplay qrCode={qrCode} tenant={tenant} />);
    expect(screen.getByText(qrCode.url)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy/ })).toBeInTheDocument();
  });
});
