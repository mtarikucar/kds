import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LimitWarning from './LimitWarning';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      // Surface the interpolated numbers so we can assert the exact
      // limit / remaining the component computed.
      if (key === 'subscriptions.limitWarning.full') {
        return `full:${opts?.resource}:limit=${opts?.limit}`;
      }
      if (key === 'subscriptions.limitWarning.near') {
        return `near:${opts?.resource}:cur=${opts?.current}:limit=${opts?.limit}:rem=${opts?.remaining}`;
      }
      return key;
    },
  }),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

const useSubscriptionMock = vi.fn();
vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => useSubscriptionMock(),
}));

function mockCheckLimit(result: any) {
  useSubscriptionMock.mockReturnValue({ checkLimit: () => result });
}

describe('LimitWarning', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing for an unlimited (-1) resource', () => {
    mockCheckLimit({ allowed: true, current: 50, limit: -1, remaining: Infinity });
    const { container } = render(
      <LimitWarning resource="maxUsers" currentCount={50} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there is healthy headroom (>20% remaining)', () => {
    // limit 10, current 4 → remaining 6 > max(2, 2) → suppressed.
    mockCheckLimit({ allowed: true, current: 4, limit: 10, remaining: 6 });
    const { container } = render(
      <LimitWarning resource="maxUsers" currentCount={4} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the amber "near limit" copy with current/limit/remaining when low on headroom', () => {
    // limit 10, current 9 → remaining 1, not full.
    mockCheckLimit({ allowed: true, current: 9, limit: 10, remaining: 1 });
    render(<LimitWarning resource="maxUsers" currentCount={9} />);

    expect(
      screen.getByText('near:subscriptions.usage.users:cur=9:limit=10:rem=1'),
    ).toBeInTheDocument();
    // Not the "full" variant.
    expect(screen.queryByText(/^full:/)).toBeNull();
  });

  it('shows the red "full" copy when the limit is reached (not allowed)', () => {
    mockCheckLimit({ allowed: false, current: 10, limit: 10, remaining: 0 });
    render(<LimitWarning resource="maxTables" currentCount={10} />);

    expect(
      screen.getByText('full:subscriptions.usage.tables:limit=10'),
    ).toBeInTheDocument();
  });

  it('navigates to the plans page when the upgrade link is clicked', () => {
    mockCheckLimit({ allowed: false, current: 10, limit: 10, remaining: 0 });
    render(<LimitWarning resource="maxUsers" currentCount={10} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'subscriptions.limitWarning.upgrade' }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/subscription/plans');
  });
});
