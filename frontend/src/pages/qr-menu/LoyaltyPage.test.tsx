import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Specs for LoyaltyPage. The page wires QRMenuLayout's session callback to
 * a transactions fetch (axios) and renders LoyaltyContent once both the
 * menu data and the loyalty transactions are available. We mock the
 * layout to drive onMenuDataLoaded + onSessionIdChange, mock the content
 * to echo what it receives, and mock axios to assert the session-scoped
 * loyalty endpoint is hit and the result flows into the content.
 */

const get = vi.fn();
vi.mock('axios', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

const layoutProps: any = {};
vi.mock('./QRMenuLayout', () => ({
  default: ({ children, currentPage, onMenuDataLoaded, onSessionIdChange }: any) => {
    layoutProps.currentPage = currentPage;
    return (
      <div>
        <button onClick={() => onMenuDataLoaded({ settings: {}, tenant: { id: 't1' } })}>load-menu</button>
        <button onClick={() => onSessionIdChange('sess-9')}>set-session</button>
        {children}
      </div>
    );
  },
}));

vi.mock('../../components/qr-menu/LoyaltyContent', () => ({
  default: (props: any) => (
    <div data-testid="loyalty">
      {`session:${props.sessionId} tenant:${props.tenantId} tx:${props.transactions.length}`}
    </div>
  ),
}));

import LoyaltyPage from './LoyaltyPage';

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(layoutProps)) delete layoutProps[k];
});

describe('LoyaltyPage', () => {
  it('passes currentPage="loyalty" to the layout', () => {
    render(<LoyaltyPage />);
    expect(layoutProps.currentPage).toBe('loyalty');
  });

  it('does not fetch transactions until a session id is set', () => {
    render(<LoyaltyPage />);
    fireEvent.click(screen.getByText('load-menu'));
    expect(get).not.toHaveBeenCalled();
  });

  it('fetches session-scoped loyalty transactions and feeds them to LoyaltyContent', async () => {
    get.mockResolvedValue({ data: [{ id: 'tx1', type: 'EARN', points: 10, description: '', createdAt: '' }] });
    render(<LoyaltyPage />);

    fireEvent.click(screen.getByText('load-menu'));
    fireEvent.click(screen.getByText('set-session'));

    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining('/customer-public/loyalty/transactions?sessionId=sess-9')),
    );
    await waitFor(() =>
      expect(screen.getByTestId('loyalty').textContent).toBe('session:sess-9 tenant:t1 tx:1'),
    );
  });
});
