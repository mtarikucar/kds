import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SubscriptionStatusBanner from './SubscriptionStatusBanner';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      // Echo the interpolated values for the variants under test so we
      // assert the actual day-count / plan name flowing through.
      if (key === 'subscriptions.statusBanner.trialCountdown') {
        return `trial:${opts?.plan}:${opts?.days}d`;
      }
      if (key === 'subscriptions.statusBanner.gracePeriod') {
        return `grace:${opts?.days}d`;
      }
      if (key === 'subscriptions.statusBanner.preExpiry') {
        return `preExpiry:${opts?.plan}:${opts?.days}d`;
      }
      // For everything else (incl. keys with a string defaultValue) we
      // return the stable key so role/name lookups are deterministic.
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

const NOW = new Date('2026-06-14T12:00:00.000Z');

function ctx(subscription: any, overrides: any = {}) {
  const status = subscription?.status;
  useSubscriptionMock.mockReturnValue({
    subscription,
    plan: { displayName: 'Pro' },
    isSubscriptionActive: status === 'ACTIVE' || status === 'TRIALING',
    isInGracePeriod: status === 'PAST_DUE',
    ...overrides,
  });
}

describe('SubscriptionStatusBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    navigateMock.mockClear();
    useSubscriptionMock.mockReset();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there is no subscription', () => {
    ctx(null);
    const { container } = render(<SubscriptionStatusBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a trial countdown and subscribes via checkout with planId + billingCycle', () => {
    ctx({
      status: 'TRIALING',
      isTrialPeriod: true,
      trialEnd: '2026-06-19T12:00:00.000Z', // 5 days out
      planId: 'plan-pro',
      billingCycle: 'MONTHLY',
    });

    render(<SubscriptionStatusBanner />);
    expect(screen.getByText('trial:Pro:5d')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'subscriptions.statusBanner.subscribeNow',
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith(
      '/subscription/checkout?planId=plan-pro&billingCycle=MONTHLY',
    );
  });

  it('hides the trial banner once the trial end is in the past', () => {
    ctx({
      status: 'TRIALING',
      isTrialPeriod: true,
      trialEnd: '2026-06-10T12:00:00.000Z', // already passed
      planId: 'plan-pro',
      billingCycle: 'MONTHLY',
    });
    const { container } = render(<SubscriptionStatusBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a pre-expiry renew banner for an ACTIVE non-trial sub ending within 7 days', () => {
    ctx({
      status: 'ACTIVE',
      isTrialPeriod: false,
      currentPeriodEnd: '2026-06-17T12:00:00.000Z', // 3 days out
      planId: 'plan-pro',
      billingCycle: 'YEARLY',
    });

    render(<SubscriptionStatusBanner />);
    expect(screen.getByText('preExpiry:Pro:3d')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'subscriptions.statusBanner.renewNow',
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith(
      '/subscription/checkout?planId=plan-pro&billingCycle=YEARLY',
    );
  });

  it('does NOT show a pre-expiry banner when renewal is more than 7 days out', () => {
    ctx({
      status: 'ACTIVE',
      isTrialPeriod: false,
      currentPeriodEnd: '2026-07-30T12:00:00.000Z', // ~46 days out
      planId: 'plan-pro',
      billingCycle: 'MONTHLY',
    });
    const { container } = render(<SubscriptionStatusBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a grace-period banner (7 days after period end) for PAST_DUE and navigates to plans on Pay now', () => {
    ctx({
      status: 'PAST_DUE',
      isTrialPeriod: false,
      currentPeriodEnd: '2026-06-11T12:00:00.000Z', // grace ends 2026-06-18 → 4 days left
      planId: 'plan-pro',
      billingCycle: 'MONTHLY',
    });

    render(<SubscriptionStatusBanner />);
    expect(screen.getByText('grace:4d')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'subscriptions.statusBanner.payNow' }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/subscription/plans');
  });

  it('shows a hard expired banner and re-subscribes via plans?renew=1', () => {
    ctx({
      status: 'EXPIRED',
      isTrialPeriod: false,
      currentPeriodEnd: '2026-05-01T12:00:00.000Z',
      planId: 'plan-pro',
      billingCycle: 'MONTHLY',
    });

    render(<SubscriptionStatusBanner />);
    expect(
      screen.getByText('subscriptions.statusBanner.resubscribe'),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'subscriptions.statusBanner.resubscribe',
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/subscription/plans?renew=1');
  });

  it('hides the banner for this session once dismissed (sessionStorage)', () => {
    ctx({
      status: 'TRIALING',
      isTrialPeriod: true,
      trialEnd: '2026-06-19T12:00:00.000Z',
      planId: 'plan-pro',
      billingCycle: 'MONTHLY',
    });

    const { rerender } = render(<SubscriptionStatusBanner />);
    fireEvent.click(
      screen.getByRole('button', { name: 'subscriptions.statusBanner.dismiss' }),
    );

    // Re-render with the same context: the dismiss flag in sessionStorage
    // suppresses the banner.
    rerender(<SubscriptionStatusBanner />);
    expect(screen.queryByText('trial:Pro:5d')).toBeNull();
  });
});
