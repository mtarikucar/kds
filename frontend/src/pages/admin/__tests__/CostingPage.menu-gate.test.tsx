import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CostingPage from '../CostingPage';

// Menu-engineering is ADVANCED_REPORTS-gated on the backend while the rest of
// the page is inventoryTracking-gated. Rather than let a BASIC tenant hit the
// tab and 403 into an upsell, the tab itself is hidden when the feature isn't
// granted (ReportsPage allTabs.filter pattern) and the default tab falls back
// to the first visible one. A load error is always a genuine failure now, so
// it always shows the plain retry message — never purchase advice.
const menuState: { current: any } = { current: {} };
const subState: { current: { hasFeature: (k: string) => boolean } } = {
  current: { hasFeature: () => true },
};

vi.mock('../../../hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `₺${n}`,
}));
vi.mock('../../../features/stock-management/costingApi', () => ({
  useMenuEngineering: () => menuState.current,
  useUsageVariance: () => ({ data: undefined, isLoading: false }),
}));
vi.mock('../../../features/stock-management/stockManagementApi', () => ({
  useRecipes: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => subState.current,
}));

describe('CostingPage — menu-engineering gate', () => {
  beforeEach(() => {
    menuState.current = { isLoading: false, isError: false, data: { items: [] } };
    subState.current = { hasFeature: () => true };
  });

  it('hides the menu-engineering tab when advancedReports is not granted', () => {
    subState.current = { hasFeature: (k: string) => k !== 'advancedReports' };
    render(<CostingPage />);
    expect(screen.queryByRole('button', { name: /costing\.tabMenu/ })).toBeNull();
  });

  it('falls back to the first visible tab when the menu tab is hidden', () => {
    subState.current = { hasFeature: (k: string) => k !== 'advancedReports' };
    render(<CostingPage />);
    // Usage-variance is the next tab in order and becomes active by default.
    expect(screen.getByText(/costing\.varianceTitle/)).toBeTruthy();
  });

  it('shows the menu-engineering tab when advancedReports is granted', () => {
    render(<CostingPage />);
    expect(screen.getByRole('button', { name: /costing\.tabMenu/ })).toBeTruthy();
  });

  it('shows a retry message (not purchase advice) on any load error, even a 403', () => {
    menuState.current = {
      isLoading: false,
      isError: true,
      error: { response: { status: 403 } },
    };
    render(<CostingPage />);
    expect(screen.getByText(/reports\.loadError/)).toBeTruthy();
    expect(screen.queryByText(/costing\.upgradeRequired/)).toBeNull();
  });

  it('surfaces the uncosted-products count', () => {
    menuState.current = {
      isLoading: false,
      isError: false,
      data: { items: [], counts: { uncosted: 3 } },
    };
    render(<CostingPage />);
    expect(screen.getByText(/costing\.uncosted/)).toBeTruthy();
  });
});
