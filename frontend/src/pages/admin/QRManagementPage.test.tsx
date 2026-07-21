import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { QrCodeData, QrMenuSettings } from '../../types';

const h = vi.hoisted(() => ({
  settings: { data: undefined as QrMenuSettings | undefined, isLoading: false },
  codes: { data: undefined as unknown, isLoading: false },
  updateSettings: vi.fn(),
}));

vi.mock('../../features/qr/qrApi', () => ({
  useQrSettings: () => h.settings,
  useQrCodes: () => h.codes,
  useUpdateQrSettings: () => ({ mutate: h.updateSettings, isPending: false }),
}));
// The design tab has its own coverage; stub to isolate the codes tab.
vi.mock('../../components/qr/DesignEditor', () => ({
  default: () => <div data-testid="design-editor" />,
}));

import QRManagementPage from './QRManagementPage';

const settings: QrMenuSettings = {
  id: 'qs-1',
  tenantId: 't1',
  primaryColor: '#000000',
  secondaryColor: '#333333',
  backgroundColor: '#FFFFFF',
  fontFamily: 'Inter',
  showRestaurantInfo: true,
  showPrices: true,
  showDescription: true,
  showImages: true,
  layoutStyle: 'GRID',
  itemsPerRow: 2,
  enableTableQR: true,
  tableQRMessage: 'Scan for our menu',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const qrCodes: QrCodeData[] = [
  {
    id: 'tenant-qr',
    type: 'TENANT',
    url: 'https://example.com/qr-menu/t1',
    qrDataUrl: '',
    label: 'Acme Diner',
  },
  {
    id: 'table-1',
    type: 'TABLE',
    url: 'https://example.com/qr-menu/t1?tableId=table-1',
    qrDataUrl: '',
    label: 'Table 1',
    tableId: 'table-1',
    tableNumber: '1',
  },
  {
    id: 'table-5',
    type: 'TABLE',
    url: 'https://example.com/qr-menu/t1?tableId=table-5',
    qrDataUrl: '',
    label: 'Table 5',
    tableId: 'table-5',
    tableNumber: '5',
  },
  {
    id: 'table-garden',
    type: 'TABLE',
    url: 'https://example.com/qr-menu/t1?tableId=table-garden',
    qrDataUrl: '',
    label: 'Bahçe 2',
    tableId: 'table-garden',
    tableNumber: 'B2',
  },
];

beforeEach(() => {
  h.settings.data = { ...settings };
  h.settings.isLoading = false;
  h.codes.data = { tenant: { id: 't1', name: 'Acme Diner' }, settings, qrCodes };
  h.codes.isLoading = false;
  h.updateSettings.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QRManagementPage (two-pane redesign)', () => {
  it('does not render the statistics tile row', () => {
    render(<QRManagementPage />);
    // Both the translated string and the raw key (in case the tile JSX
    // regresses back in after its i18n key was deleted).
    expect(screen.queryByText('Total QR Codes')).not.toBeInTheDocument();
    expect(screen.queryByText(/admin\.totalQRCodes/)).not.toBeInTheDocument();
  });

  it('keeps the guided-tour anchors', () => {
    const { container } = render(<QRManagementPage />);
    expect(container.querySelector('[data-tour="qr-management"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="qr-download"]')).toBeTruthy();
    expect(container.querySelector('[data-tour="qr-codes-list"]')).toBeTruthy();
  });

  it('filters table cards by the search input', () => {
    render(<QRManagementPage />);
    const search = screen.getByPlaceholderText('Search tables…');

    fireEvent.change(search, { target: { value: 'table 5' } });
    expect(screen.getByText('Table 5')).toBeInTheDocument();
    expect(screen.queryByText('Table 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Bahçe 2')).not.toBeInTheDocument();
  });

  it('search is locale-insensitive on the label', () => {
    render(<QRManagementPage />);
    const search = screen.getByPlaceholderText('Search tables…');

    fireEvent.change(search, { target: { value: 'bahçe' } });
    expect(screen.getByText('Bahçe 2')).toBeInTheDocument();
    expect(screen.queryByText('Table 1')).not.toBeInTheDocument();
  });

  it('shows a no-match state with a clear action when the search misses', () => {
    render(<QRManagementPage />);
    const search = screen.getByPlaceholderText('Search tables…');

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No tables match your search')).toBeInTheDocument();

    // Both the input's ✕ and the empty-state action are named "Clear search";
    // the empty-state one (rendered last) is the flow under test.
    const clearButtons = screen.getAllByRole('button', { name: 'Clear search' });
    fireEvent.click(clearButtons[clearButtons.length - 1]);
    expect(screen.getByText('Table 1')).toBeInTheDocument();
    expect(screen.getByText('Bahçe 2')).toBeInTheDocument();
  });

  it('hosts the batch actions inside the table section, not the page header', () => {
    render(<QRManagementPage />);
    const tableSection = screen
      .getByText('Table-Specific QR Codes')
      .closest('section') as HTMLElement;
    expect(tableSection).toBeTruthy();

    expect(
      within(tableSection).getByRole('button', { name: /Print Table QR Sheet/ }),
    ).toBeInTheDocument();
    expect(
      within(tableSection).getByRole('button', { name: /Download All QR Codes/ }),
    ).toBeInTheDocument();
  });

  it('hides the table pane entirely when table QR is disabled', () => {
    h.settings.data = { ...settings, enableTableQR: false };
    render(<QRManagementPage />);
    expect(screen.queryByText('Table-Specific QR Codes')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search tables…')).not.toBeInTheDocument();
  });

  it('prints only the filtered tables when a search is active', () => {
    render(<QRManagementPage />);
    fireEvent.change(screen.getByPlaceholderText('Search tables…'), {
      target: { value: 'table 5' },
    });

    const writes: string[] = [];
    const fakeWindow = {
      document: { write: (html: string) => writes.push(html), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(fakeWindow as unknown as Window);

    fireEvent.click(screen.getByRole('button', { name: /Print Table QR Sheet/ }));

    const html = writes.join('');
    expect(html).toContain('Table 5');
    expect(html).not.toContain('Table 1');
    expect(html).not.toContain('Bahçe 2');
  });

  it('alerts instead of printing when the search matches no tables', () => {
    render(<QRManagementPage />);
    fireEvent.change(screen.getByPlaceholderText('Search tables…'), {
      target: { value: 'zzz' },
    });

    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const openSpy = vi.spyOn(window, 'open');

    fireEvent.click(screen.getByRole('button', { name: /Print Table QR Sheet/ }));

    expect(alertSpy).toHaveBeenCalledWith('No table QR codes found to print.');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('renders the hero without the table pane while settings are still undefined', () => {
    h.settings.data = undefined;
    render(<QRManagementPage />);
    expect(screen.getByText('Restaurant QR Code')).toBeInTheDocument();
    expect(screen.queryByText('Table-Specific QR Codes')).not.toBeInTheDocument();
  });

  it('shows the no-tables empty state when only the restaurant code exists', () => {
    h.codes.data = {
      tenant: { id: 't1', name: 'Acme Diner' },
      settings,
      qrCodes: [qrCodes[0]],
    };
    render(<QRManagementPage />);
    expect(screen.getByText('No Tables Found')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search tables…')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Print Table QR Sheet/ }),
    ).not.toBeInTheDocument();
  });

  it('survives an undefined codes payload (load race)', () => {
    h.codes.data = undefined;
    render(<QRManagementPage />);
    expect(screen.getByText('Restaurant QR Code')).toBeInTheDocument();
  });

  it('shows the filtered count on the batch buttons while a search is active', () => {
    render(<QRManagementPage />);
    fireEvent.change(screen.getByPlaceholderText('Search tables…'), {
      target: { value: 'table' },
    });
    expect(
      screen.getByRole('button', { name: /Print Table QR Sheet \(2\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Download All QR Codes \(2\)/ }),
    ).toBeInTheDocument();
  });

  it('snapshots the SVGs at click time so later UI changes cannot drop downloads', () => {
    vi.useFakeTimers();
    try {
      render(<QRManagementPage />);
      fireEvent.change(screen.getByPlaceholderText('Search tables…'), {
        target: { value: 'table' },
      });
      const serializeSpy = vi.spyOn(XMLSerializer.prototype, 'serializeToString');

      fireEvent.click(screen.getByRole('button', { name: /Download All QR Codes/ }));

      // Both filtered tables serialized synchronously at click — before any
      // staggered timer fires and regardless of what unmounts afterwards.
      expect(serializeSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
