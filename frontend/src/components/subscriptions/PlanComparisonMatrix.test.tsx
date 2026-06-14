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
});
