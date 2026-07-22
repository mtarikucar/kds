import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import PlanComparisonMatrix from './PlanComparisonMatrix';
import { Plan, SubscriptionPlanType } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function makePlan(over: Partial<Plan>): Plan {
  return {
    id: over.id ?? 'p',
    name: over.name ?? SubscriptionPlanType.FREE,
    displayName: over.displayName ?? 'Plan',
    description: '',
    monthlyPrice: over.monthlyPrice ?? 0,
    yearlyPrice: 0,
    currency: 'TRY',
    trialDays: 0,
    limits: {
      maxUsers: 1,
      maxTables: 1,
      maxBranches: 1,
      maxProducts: 1,
      maxCategories: 1,
      maxMonthlyOrders: 1,
      ...(over.limits as any),
    },
    features: {
      advancedReports: false,
      multiLocation: false,
      customBranding: false,
      apiAccess: false,
      prioritySupport: false,
      inventoryTracking: false,
      kdsIntegration: false,
      reservationSystem: false,
      personnelManagement: false,
      deliveryIntegration: false,
      posAccess: false,
      ...(over.features as any),
    },
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as Plan;
}

const plans: Plan[] = [
  makePlan({
    id: 'pro',
    displayName: 'Pro',
    monthlyPrice: 300,
    limits: { maxUsers: -1, maxTables: 50 } as any,
    features: { kdsIntegration: true, apiAccess: true } as any,
  }),
  makePlan({
    id: 'free',
    displayName: 'Free',
    monthlyPrice: 0,
    limits: { maxUsers: 2, maxTables: 5 } as any,
    features: { kdsIntegration: true, apiAccess: false } as any,
  }),
];

describe('PlanComparisonMatrix', () => {
  it('is collapsed by default (no table) and expands on toggle', () => {
    render(<PlanComparisonMatrix plans={plans} />);
    expect(screen.queryByRole('table')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: /subscriptions.comparison.toggle/i }),
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('orders the plan columns cheapest → most expensive', () => {
    render(<PlanComparisonMatrix plans={plans} />);
    fireEvent.click(
      screen.getByRole('button', { name: /subscriptions.comparison.toggle/i }),
    );

    const headers = screen.getAllByRole('columnheader');
    // First col is the feature header label; then plans in price order.
    expect(headers[1]).toHaveTextContent('Free');
    expect(headers[2]).toHaveTextContent('Pro');
  });

  it('renders ∞ for an unlimited (-1) limit and grouped numbers otherwise', () => {
    render(<PlanComparisonMatrix plans={plans} />);
    fireEvent.click(
      screen.getByRole('button', { name: /subscriptions.comparison.toggle/i }),
    );

    // Pro has maxUsers -1 → ∞.
    expect(screen.getByText('∞')).toBeInTheDocument();
    // maxTables row: Free=5, Pro=50.
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('renders a price row with monthly price + currency (and Free for zero)', () => {
    render(<PlanComparisonMatrix plans={plans} />);
    fireEvent.click(
      screen.getByRole('button', { name: /subscriptions.comparison.toggle/i }),
    );

    // Locate the price row by its label cell.
    const priceRow = screen
      .getByText('subscriptions.comparison.priceRow')
      .closest('tr')!;
    const cells = within(priceRow).getAllByRole('cell');
    // 1 label cell + Free + Pro (cheapest → expensive).
    expect(cells).toHaveLength(3);
    // Free (0) → "Ücretsiz" fallback; Pro (300) → "300 TRY".
    expect(within(priceRow).getByText('subscriptions.comparison.free')).toBeInTheDocument();
    expect(within(priceRow).getByText('300 TRY')).toBeInTheDocument();
  });

  it('renders a feature check only where the plan grants it', () => {
    render(<PlanComparisonMatrix plans={plans} />);
    fireEvent.click(
      screen.getByRole('button', { name: /subscriptions.comparison.toggle/i }),
    );

    // apiAccess row: locate the row by its label cell, then count checks.
    const apiRow = screen
      .getByText('subscriptions.comparison.features.apiAccess')
      .closest('tr')!;
    // Only Pro has apiAccess → exactly 1 check icon (lucide renders an svg).
    const checks = within(apiRow).getAllByRole('cell');
    // 1 label cell + 2 plan cells.
    expect(checks).toHaveLength(3);
    // Free cell (index 1) has no check svg with emerald class; Pro (index 2) does.
    const proCell = checks[2];
    expect(proCell.querySelector('svg')).toBeTruthy();
  });

  // Drift regression (backend getAvailablePlans was missing `posAccess` in
  // its features block, so every plan showed ✗ for POS on the sales page —
  // see plan-mapper-parity.spec.ts on the backend for the tripwire that now
  // guards this). Both plans here grant posAccess=true; the row must show a
  // check for both, not an X.
  it('renders the POS row correctly once the backend sends posAccess', () => {
    const withPos: Plan[] = plans.map((p) => ({
      ...p,
      features: { ...p.features, posAccess: true },
    }));
    render(<PlanComparisonMatrix plans={withPos} />);
    fireEvent.click(
      screen.getByRole('button', { name: /subscriptions.comparison.toggle/i }),
    );

    const posRow = screen
      .getByText('subscriptions.comparison.features.posAccess')
      .closest('tr')!;
    const cells = within(posRow).getAllByRole('cell');
    // 1 label cell + 2 plan cells, both checked.
    expect(cells).toHaveLength(3);
    expect(cells[1].querySelector('svg')).toBeTruthy();
    expect(cells[2].querySelector('svg')).toBeTruthy();
  });

  // Drift regression (backend getAvailablePlans was missing `maxBranches` in
  // its limits block, so Number(undefined) rendered the literal string
  // "NaN" in the Şube sayısı cell). Once the backend sends the value it
  // renders as a normal grouped number.
  it('renders a numeric maxBranches cell (not "NaN") when present', () => {
    const withBranches: Plan[] = plans.map((p) => ({
      ...p,
      limits: { ...p.limits, maxBranches: 3 },
    }));
    render(<PlanComparisonMatrix plans={withBranches} />);
    fireEvent.click(
      screen.getByRole('button', { name: /subscriptions.comparison.toggle/i }),
    );

    const branchRow = screen
      .getByText('subscriptions.comparison.limits.maxBranches')
      .closest('tr')!;
    expect(within(branchRow).queryByText('NaN')).toBeNull();
    expect(within(branchRow).getAllByText('3')).toHaveLength(2);
  });

  // Defensive regression: even if a mapper drifts again in the future and
  // omits a limit key entirely, the cell must degrade to an em dash rather
  // than the confusing literal "NaN".
  it('renders "—" instead of "NaN" when a limit key is missing from the payload', () => {
    const missingBranches: Plan[] = plans.map((p) => {
      const limits = { ...p.limits } as any;
      delete limits.maxBranches;
      return { ...p, limits };
    });
    render(<PlanComparisonMatrix plans={missingBranches} />);
    fireEvent.click(
      screen.getByRole('button', { name: /subscriptions.comparison.toggle/i }),
    );

    const branchRow = screen
      .getByText('subscriptions.comparison.limits.maxBranches')
      .closest('tr')!;
    expect(within(branchRow).queryByText('NaN')).toBeNull();
    expect(within(branchRow).getAllByText('—')).toHaveLength(2);
  });
});
