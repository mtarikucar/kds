import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InvoiceViewerModal from './InvoiceViewerModal';

// `t` MUST be a stable reference: the component's data-fetch effect lists
// `t` in its deps, so a fresh `t` each render would re-fire the effect and
// the previous run's cleanup (cancelled=true) would swallow the catch.
const tStable = (key: string) => key;
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tStable }),
}));

// Mock the authed axios client; the modal fetches the PDF blob through it
// (responseType: 'blob') rather than window.open, which would dodge auth.
const apiGet = vi.fn();
vi.mock('../../lib/api', () => ({
  default: { get: (...args: unknown[]) => apiGet(...args) },
}));

describe('InvoiceViewerModal', () => {
  beforeEach(() => {
    apiGet.mockReset();
    // jsdom lacks createObjectURL/revokeObjectURL.
    (URL as any).createObjectURL = vi.fn(() => 'blob:fake-url');
    (URL as any).revokeObjectURL = vi.fn();
  });

  it('renders nothing when no invoiceNumber is provided', () => {
    const { container } = render(
      <InvoiceViewerModal invoiceNumber={null} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('fetches the PDF blob from /invoices/:number/download and shows the iframe + download link', async () => {
    apiGet.mockResolvedValue({ data: new Blob(['%PDF'], { type: 'application/pdf' }) });

    render(
      <InvoiceViewerModal
        invoiceNumber="INV-202606-0001-ABCDE"
        onClose={vi.fn()}
      />,
    );

    // Correct authed endpoint + blob response type.
    expect(apiGet).toHaveBeenCalledWith(
      '/invoices/INV-202606-0001-ABCDE/download',
      { responseType: 'blob' },
    );

    // Header always shows the invoice number.
    expect(screen.getByText('INV-202606-0001-ABCDE')).toBeInTheDocument();

    // Once the blob resolves, the iframe + a download anchor appear.
    const iframe = await screen.findByTitle('Invoice INV-202606-0001-ABCDE');
    expect(iframe).toHaveAttribute('src', 'blob:fake-url');

    const link = screen.getByRole('link', {
      name: /subscriptions.invoiceCard.download/i,
    });
    expect(link).toHaveAttribute('href', 'blob:fake-url');
    expect(link).toHaveAttribute(
      'download',
      'invoice-INV-202606-0001-ABCDE.pdf',
    );
  });

  it('shows the server error message when the download fails', async () => {
    apiGet.mockImplementation(() =>
      Promise.reject({ response: { data: { message: 'Invoice not found' } } }),
    );

    render(
      <InvoiceViewerModal invoiceNumber="INV-404" onClose={vi.fn()} />,
    );

    // findByText flushes the rejected-promise microtask inside act().
    expect(await screen.findByText('Invoice not found')).toBeInTheDocument();
    // No iframe on the error path.
    expect(screen.queryByTitle(/Invoice INV-404/)).toBeNull();
  });

  it('closes when the close button is clicked', async () => {
    apiGet.mockResolvedValue({ data: new Blob(['%PDF']) });
    const onClose = vi.fn();
    render(<InvoiceViewerModal invoiceNumber="INV-1" onClose={onClose} />);

    // Let the blob fetch settle (avoids an act() warning) before clicking.
    await screen.findByTitle('Invoice INV-1');

    fireEvent.click(
      screen.getByRole('button', { name: 'subscriptions.invoiceViewer.close' }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
