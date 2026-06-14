import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InvoiceCard } from './InvoiceCard';

// Mock the api layer: downloadInvoice is the side-effecting action we
// assert fires with the *invoiceNumber* (the backend resolves the
// /invoices/:id route by invoiceNumber, not the UUID — passing the UUID
// would 404, see InvoiceCard.handleDownload).
const downloadInvoice = vi.fn();
vi.mock('../../api/paymentsApi', () => ({
  downloadInvoice: (...args: unknown[]) => downloadInvoice(...args),
}));

// The viewer modal is a separate component with its own data fetching;
// stub it so opening the viewer is observable without pulling in that
// component's network layer.
vi.mock('./InvoiceViewerModal', () => ({
  default: ({ invoiceNumber }: { invoiceNumber: string }) => (
    <div data-testid="invoice-viewer">viewer:{invoiceNumber}</div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const invoice = {
  id: 'uuid-1234',
  invoiceNumber: 'INV-202606-0001-ABCDE',
  status: 'PAID',
  total: 249.9,
  currency: 'TRY',
  periodStart: '2026-06-01T00:00:00.000Z',
  periodEnd: '2026-06-30T00:00:00.000Z',
  paidAt: '2026-06-02T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
};

describe('InvoiceCard', () => {
  beforeEach(() => {
    downloadInvoice.mockClear();
  });

  it('renders the invoice number and the formatted total', () => {
    render(<InvoiceCard invoice={invoice} />);

    expect(screen.getByText('INV-202606-0001-ABCDE')).toBeInTheDocument();
    // currency + total, 2 decimals.
    expect(screen.getByText('TRY 249.90')).toBeInTheDocument();
  });

  it('fires downloadInvoice with the invoiceNumber (not the UUID) on download', () => {
    render(<InvoiceCard invoice={invoice} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: /subscriptions.invoiceCard.download/i,
      }),
    );

    expect(downloadInvoice).toHaveBeenCalledTimes(1);
    expect(downloadInvoice).toHaveBeenCalledWith('INV-202606-0001-ABCDE');
  });

  it('opens the invoice viewer (not a download) when View is clicked', () => {
    render(<InvoiceCard invoice={invoice} />);

    expect(screen.queryByTestId('invoice-viewer')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /subscriptions.invoiceCard.view/i }),
    );

    expect(screen.getByTestId('invoice-viewer')).toHaveTextContent(
      'viewer:INV-202606-0001-ABCDE',
    );
    expect(downloadInvoice).not.toHaveBeenCalled();
  });

  it('shows the open/unpaid badge for a non-PAID invoice', () => {
    render(
      <InvoiceCard invoice={{ ...invoice, status: 'OPEN', paidAt: undefined }} />,
    );

    expect(
      screen.getByText('subscriptions.invoiceCard.open'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('subscriptions.invoiceCard.paid'),
    ).not.toBeInTheDocument();
  });
});
