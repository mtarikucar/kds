import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CostingTab from './CostingTab';

// Menu-engineering is ADVANCED_REPORTS-gated on the backend while the page is
// inventoryTracking-gated — the default tab must distinguish a plan-gate 403
// (honest upsell) from any other failure (retry message, NOT purchase advice),
// and must surface the hidden 'uncosted' count instead of dropping it.
// Moved from the deleted pages/admin/__tests__/CostingPage.menu-gate.test.tsx
// — the special-case was lifted verbatim into CostingTab's MenuTab.
const menuState: { current: any } = { current: {} };

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
// CostingTab also renders the CRUD RecipesTab (ingredient/recipe management),
// unrelated to the menu-engineering 403 case under test here — stub it out.
vi.mock('../../../features/stock-management/components/RecipesTab', () => ({
  default: () => <div data-testid="recipes-crud-stub" />,
}));

describe('CostingTab — menu tab plan-gate handling', () => {
  beforeEach(() => {
    menuState.current = {};
  });

  it('shows the upgrade message ONLY on a 403', () => {
    menuState.current = {
      isLoading: false,
      isError: true,
      error: { response: { status: 403 } },
    };
    render(<CostingTab />);
    expect(screen.getByText(/costing\.upgradeRequired/)).toBeTruthy();
  });

  it('shows a retry message (not purchase advice) on a 500', () => {
    menuState.current = {
      isLoading: false,
      isError: true,
      error: { response: { status: 500 } },
    };
    render(<CostingTab />);
    expect(screen.getByText(/reports\.loadError/)).toBeTruthy();
    expect(screen.queryByText(/costing\.upgradeRequired/)).toBeNull();
  });

  it('surfaces the uncosted-products count', () => {
    menuState.current = {
      isLoading: false,
      isError: false,
      data: { items: [], counts: { uncosted: 3 } },
    };
    render(<CostingTab />);
    expect(screen.getByText(/costing\.uncosted/)).toBeTruthy();
  });
});
