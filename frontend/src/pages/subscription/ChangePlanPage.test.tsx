import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChangePlanPage from './ChangePlanPage';

// The plans page navigates here with ?newPlanId&billingCycle already chosen.
// These tests pin the fix: that choice must open the confirmation directly,
// instead of forcing the user to re-pick the same plan on this page.

const mutateAsync = vi.fn();
const navigateMock = vi.fn();

const currentSub = {
  id: 'sub-1',
  planId: 'plan-basic',
  status: 'ACTIVE',
  amount: '100',
  billingCycle: 'MONTHLY',
  currentPeriodEnd: '2026-12-31T00:00:00.000Z',
};
const plans = [
  { id: 'plan-basic', name: 'BASIC', displayName: 'Basic', monthlyPrice: '100', yearlyPrice: '1000', currency: 'TRY' },
  { id: 'plan-pro', name: 'PRO', displayName: 'Pro', monthlyPrice: '500', yearlyPrice: '5000', currency: 'TRY' },
];

vi.mock('../../features/subscriptions/subscriptionsApi', () => ({
  useGetCurrentSubscription: () => ({ data: currentSub, isLoading: false }),
  useGetPlans: () => ({ data: plans, isLoading: false }),
  useChangePlan: () => ({ mutateAsync, isPending: false }),
  useGetScheduledDowngrade: () => ({ data: null }),
}));

// Stub PlanCard — this suite targets the page's preselection/auto-open logic,
// not PlanCard's own feature rendering (which needs full plan.features data).
vi.mock('../../components/subscriptions/PlanCard', () => ({
  default: ({ plan, onSelectPlan }: any) => (
    <button onClick={() => onSelectPlan(plan.id)}>card-{plan.id}</button>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: any) => {
      if (typeof arg === 'string') return arg;
      if (arg && typeof arg.defaultValue === 'string') return arg.defaultValue;
      return key;
    },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function renderPage(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/subscription/change-plan${search}`]}>
      <ChangePlanPage />
    </MemoryRouter>,
  );
}

describe('ChangePlanPage — honors the plan picked on the plans page', () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    navigateMock.mockReset();
  });

  it('auto-opens the confirm modal for ?newPlanId (no redundant re-pick)', () => {
    renderPage('?newPlanId=plan-pro&billingCycle=YEARLY');
    // Modal returns null when closed; its confirm CTA being present means it
    // opened straight away — without the user clicking a plan again.
    expect(screen.getByText('subscriptions.confirmUpgrade')).toBeInTheDocument();
  });

  it('confirming the auto-opened modal changes to exactly the preselected plan + cycle', () => {
    mutateAsync.mockResolvedValue({ type: 'upgrade', requiresPayment: false });
    renderPage('?newPlanId=plan-pro&billingCycle=YEARLY');
    fireEvent.click(screen.getByText('subscriptions.confirmUpgrade'));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      id: 'sub-1',
      data: { newPlanId: 'plan-pro', billingCycle: 'YEARLY' },
    });
  });

  it('does NOT auto-open the modal when no plan was preselected (manual flow preserved)', () => {
    renderPage('');
    expect(screen.queryByText('subscriptions.confirmUpgrade')).not.toBeInTheDocument();
    expect(screen.queryByText('subscriptions.confirmDowngrade')).not.toBeInTheDocument();
  });

  it('ignores a preselected plan equal to the current plan (no modal)', () => {
    renderPage('?newPlanId=plan-basic&billingCycle=MONTHLY');
    expect(screen.queryByText('subscriptions.confirmUpgrade')).not.toBeInTheDocument();
    expect(screen.queryByText('subscriptions.confirmDowngrade')).not.toBeInTheDocument();
  });
});
