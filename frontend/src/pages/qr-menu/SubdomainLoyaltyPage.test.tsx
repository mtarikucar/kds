import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Specs for SubdomainLoyaltyPage — same as LoyaltyPage but threads
 * `subdomain` to the layout. Asserts the subdomain passthrough and the
 * session-scoped transaction fetch flowing into LoyaltyContent.
 */

const get = vi.fn();
vi.mock('axios', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

const layoutProps: any = {};
vi.mock('./QRMenuLayout', () => ({
  default: ({ children, subdomain, onMenuDataLoaded, onSessionIdChange }: any) => {
    layoutProps.subdomain = subdomain;
    return (
      <div>
        <button onClick={() => onMenuDataLoaded({ settings: {}, tenant: { id: 't2' } })}>load-menu</button>
        <button onClick={() => onSessionIdChange('sess-3')}>set-session</button>
        {children}
      </div>
    );
  },
}));

vi.mock('../../components/qr-menu/LoyaltyContent', () => ({
  default: (props: any) => (
    <div data-testid="loyalty">{`tenant:${props.tenantId} tx:${props.transactions.length}`}</div>
  ),
}));

import SubdomainLoyaltyPage from './SubdomainLoyaltyPage';

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(layoutProps)) delete layoutProps[k];
});

describe('SubdomainLoyaltyPage', () => {
  it('forwards the subdomain to the layout', () => {
    render(<SubdomainLoyaltyPage subdomain="bistro" />);
    expect(layoutProps.subdomain).toBe('bistro');
  });

  it('fetches transactions for the session and renders them', async () => {
    get.mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }] });
    render(<SubdomainLoyaltyPage subdomain="bistro" />);

    fireEvent.click(screen.getByText('load-menu'));
    fireEvent.click(screen.getByText('set-session'));

    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining('/sessions/sess-3/loyalty/transactions')),
    );
    await waitFor(() => expect(screen.getByTestId('loyalty').textContent).toBe('tenant:t2 tx:2'));
  });
});
