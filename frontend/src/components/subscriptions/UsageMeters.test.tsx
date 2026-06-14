import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import UsageMeters from './UsageMeters';

// i18n: usage row labels echo their keys so we can locate rows reliably.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      if (key === 'subscriptions.usage.nearingLimit') {
        // Component computes pct and passes it; assert the value flows through.
        return `nearingLimit:${opts?.pct}`;
      }
      return key;
    },
  }),
}));

// Drive UsageMeters through a mocked subscription context. checkLimit is
// the real arithmetic the component relies on (limit/remaining/allowed),
// so we model it faithfully here.
const useSubscriptionMock = vi.fn();
vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => useSubscriptionMock(),
}));

function makeCheckLimit(limits: Record<string, number>) {
  return (resource: string, current: number) => {
    const limit = limits[resource];
    if (limit === -1) {
      return { allowed: true, current, limit: -1, remaining: Infinity };
    }
    const remaining = Math.max(0, limit - current);
    return { allowed: current < limit, current, limit, remaining };
  };
}

const PLAN_LIMITS = {
  maxUsers: 10,
  maxTables: 20,
  maxProducts: 200,
  maxCategories: 50,
  maxMonthlyOrders: 5000,
};

describe('UsageMeters', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when there is no active plan', () => {
    useSubscriptionMock.mockReturnValue({
      plan: null,
      checkLimit: makeCheckLimit(PLAN_LIMITS),
    });
    const { container } = render(<UsageMeters usage={{ users: 1 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders current/limit counts formatted with tr-TR grouping', () => {
    useSubscriptionMock.mockReturnValue({
      plan: { limits: PLAN_LIMITS },
      checkLimit: makeCheckLimit(PLAN_LIMITS),
    });

    render(
      <UsageMeters
        usage={{ users: 8, tables: 5, products: 1200, monthlyOrders: 2500 }}
      />,
    );

    // Each finite row shows "current / limit" with tr-TR thousands sep.
    expect(screen.getByText('8 / 10')).toBeInTheDocument();
    // products: usage 1200 vs limit 200 (over) → both formatted with '.'
    expect(screen.getByText('1.200 / 200')).toBeInTheDocument();
    expect(screen.getByText('2.500 / 5.000')).toBeInTheDocument();
  });

  it('shows the "nearing limit" hint with the rounded percentage at >=80% full', () => {
    useSubscriptionMock.mockReturnValue({
      plan: { limits: PLAN_LIMITS },
      checkLimit: makeCheckLimit(PLAN_LIMITS),
    });

    // users 9/10 = 90% → over the 80% threshold → hint with pct=90.
    render(<UsageMeters usage={{ users: 9 }} />);
    expect(screen.getByText('nearingLimit:90')).toBeInTheDocument();
  });

  it('does NOT show the nearing-limit hint when well under 80%', () => {
    useSubscriptionMock.mockReturnValue({
      plan: { limits: PLAN_LIMITS },
      checkLimit: makeCheckLimit(PLAN_LIMITS),
    });

    // users 3/10 = 30%.
    render(<UsageMeters usage={{ users: 3 }} />);
    expect(screen.getByText('3 / 10')).toBeInTheDocument();
    expect(screen.queryByText(/nearingLimit/)).toBeNull();
  });

  it('skips unlimited (-1) rows so no misleading 0% bar is drawn', () => {
    const unlimited = { ...PLAN_LIMITS, maxUsers: -1, maxTables: -1 };
    useSubscriptionMock.mockReturnValue({
      plan: { limits: unlimited },
      checkLimit: makeCheckLimit(unlimited),
    });

    render(<UsageMeters usage={{ users: 99, tables: 99, products: 10 }} />);

    // Unlimited rows aren't rendered (no "/ -1", no users count row).
    expect(screen.queryByText(/\/ -1/)).toBeNull();
    expect(screen.queryByText('99 / -1')).toBeNull();
    // The finite products row still renders.
    expect(screen.getByText('10 / 200')).toBeInTheDocument();
  });

  it('renders nothing when every limit is unlimited', () => {
    const allUnlimited = {
      maxUsers: -1,
      maxTables: -1,
      maxProducts: -1,
      maxCategories: -1,
      maxMonthlyOrders: -1,
    };
    useSubscriptionMock.mockReturnValue({
      plan: { limits: allUnlimited },
      checkLimit: makeCheckLimit(allUnlimited),
    });

    const { container } = render(
      <UsageMeters usage={{ users: 5, tables: 5, products: 5 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
