import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlanCard from './PlanCard';
import { Plan, BillingCycle, SubscriptionPlanType } from '../../types';

// i18next is mocked inline (mirrors SetupChecklist.spec.tsx) so these
// tests stay independent of the `common`/`subscriptions` resource
// bundles — we assert on the interpolated *values* (prices, plan name)
// the component computes, not on translated copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      if (opts && typeof opts.defaultValue === 'string') return opts.defaultValue;
      return key;
    },
  }),
}));

// Button calls useTranslation('common'); the mock above already covers it.

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-pro',
    name: SubscriptionPlanType.PRO,
    displayName: 'Pro',
    description: 'Pro plan',
    monthlyPrice: 100,
    yearlyPrice: 1000,
    currency: 'TRY',
    trialDays: 0,
    limits: {
      maxUsers: 5,
      maxTables: 20,
      maxBranches: 3,
      maxProducts: 200,
      maxCategories: 50,
      maxMonthlyOrders: 5000,
      maxMonthlyAiPhotos: 50,
      maxMonthlyAiVideos: 5,
    },
    features: {
      advancedReports: true,
      multiLocation: false,
      customBranding: false,
      apiAccess: false,
      prioritySupport: true,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: false,
      personnelManagement: false,
      deliveryIntegration: false,
      posAccess: true,
      externalDisplay: false,
      aiContentGeneration: true,
    },
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PlanCard', () => {
  it('renders the plan name and the monthly price for the selected cycle', () => {
    render(
      <PlanCard
        plan={makePlan()}
        billingCycle={BillingCycle.MONTHLY}
        onSelectPlan={vi.fn()}
      />,
    );

    expect(screen.getByText('Pro')).toBeInTheDocument();
    // Monthly price rendered with the TRY symbol + 2 decimals.
    expect(screen.getByText('₺100.00')).toBeInTheDocument();
  });

  it('renders the yearly price when the yearly cycle is selected', () => {
    render(
      <PlanCard
        plan={makePlan()}
        billingCycle={BillingCycle.YEARLY}
        onSelectPlan={vi.fn()}
      />,
    );

    expect(screen.getByText('₺1000.00')).toBeInTheDocument();
  });

  it('fires onSelectPlan with the plan id when the (enabled) CTA is clicked', () => {
    const onSelect = vi.fn();
    render(
      <PlanCard
        plan={makePlan()}
        billingCycle={BillingCycle.MONTHLY}
        isCurrentPlan={false}
        onSelectPlan={onSelect}
        buttonText="Select Pro"
      />,
    );

    const cta = screen.getByRole('button', { name: 'Select Pro' });
    expect(cta).toBeEnabled();
    fireEvent.click(cta);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('plan-pro');
  });

  it('disables the CTA and suppresses onSelectPlan when this is the current plan', () => {
    const onSelect = vi.fn();
    render(
      <PlanCard
        plan={makePlan()}
        billingCycle={BillingCycle.MONTHLY}
        isCurrentPlan
        onSelectPlan={onSelect}
      />,
    );

    // There are two "currentPlan" labels (badge + button text); the
    // button is the disabled one.
    const cta = screen.getByRole('button');
    expect(cta).toBeDisabled();
    fireEvent.click(cta);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disables the CTA while a mutation is in flight (isLoading)', () => {
    const onSelect = vi.fn();
    render(
      <PlanCard
        plan={makePlan()}
        billingCycle={BillingCycle.MONTHLY}
        isLoading
        onSelectPlan={onSelect}
        buttonText="Select Pro"
      />,
    );

    const cta = screen.getByRole('button');
    expect(cta).toBeDisabled();
    fireEvent.click(cta);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('spells the currency code out next to the price', () => {
    render(
      <PlanCard
        plan={makePlan()}
        billingCycle={BillingCycle.MONTHLY}
        onSelectPlan={vi.fn()}
      />,
    );

    expect(screen.getByText('₺100.00')).toBeInTheDocument();
    // ISO code shown alongside the symbol so the rail is unambiguous.
    expect(screen.getByText('TRY')).toBeInTheDocument();
  });

  it('badges a non-TRY plan as bank-transfer-only and shows the USD code', () => {
    render(
      <PlanCard
        plan={makePlan({ currency: 'USD' })}
        billingCycle={BillingCycle.MONTHLY}
        onSelectPlan={vi.fn()}
      />,
    );

    expect(screen.getByText('Havale ile ödeme')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
    // USD symbol used, not the TRY symbol.
    expect(screen.getByText('$100.00')).toBeInTheDocument();
  });

  it('does NOT show the bank-transfer badge for a TRY plan', () => {
    render(
      <PlanCard
        plan={makePlan({ currency: 'TRY' })}
        billingCycle={BillingCycle.MONTHLY}
        onSelectPlan={vi.fn()}
      />,
    );

    expect(screen.queryByText('Havale ile ödeme')).toBeNull();
  });

  it('guards the CTA as a dead-end when selectDisabledHint is set (no select fires)', () => {
    const onSelect = vi.fn();
    render(
      <PlanCard
        plan={makePlan({ currency: 'USD' })}
        billingCycle={BillingCycle.MONTHLY}
        onSelectPlan={onSelect}
        buttonText="Select Pro"
        selectDisabledHint="Bu plan için ödeme yöntemi yapılandırılmamış"
      />,
    );

    const cta = screen.getByRole('button', { name: 'Select Pro' });
    expect(cta).toBeDisabled();
    expect(cta).toHaveAttribute('title', 'Bu plan için ödeme yöntemi yapılandırılmamış');
    fireEvent.click(cta);
    expect(onSelect).not.toHaveBeenCalled();
    // Visible explanatory hint under the CTA.
    expect(
      screen.getByText('Bu plan için ödeme yöntemi yapılandırılmamış'),
    ).toBeInTheDocument();
  });

  it('renders the discounted total with the original price struck through', () => {
    const plan = makePlan({
      discount: {
        percentage: 25,
        label: 'Launch',
        endDate: '2026-12-31T00:00:00.000Z',
        discountedMonthlyPrice: 75,
        discountedYearlyPrice: 750,
      },
    } as Partial<Plan>);

    render(
      <PlanCard
        plan={plan}
        billingCycle={BillingCycle.MONTHLY}
        onSelectPlan={vi.fn()}
      />,
    );

    // Discounted price is the headline; original is shown struck-through.
    expect(screen.getByText('₺75.00')).toBeInTheDocument();
    expect(screen.getByText('₺100.00')).toBeInTheDocument();
  });
});
