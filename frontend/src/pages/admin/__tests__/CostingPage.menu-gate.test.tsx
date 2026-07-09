import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CostingPage from '../CostingPage';

// Menu-engineering is ADVANCED_REPORTS-gated on the backend while the page is
// inventoryTracking-gated — the default tab must distinguish a plan-gate 403
// (honest upsell) from any other failure (retry message, NOT purchase advice),
// and must surface the hidden 'uncosted' count instead of dropping it.
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

describe('CostingPage — menu tab plan-gate handling', () => {
  beforeEach(() => {
    menuState.current = {};
  });

  it('shows the upgrade message ONLY on a 403', () => {
    menuState.current = {
      isLoading: false,
      isError: true,
      error: { response: { status: 403 } },
    };
    render(<CostingPage />);
    expect(screen.getByText(/Gelişmiş Raporlar/)).toBeTruthy();
  });

  it('shows a retry message (not purchase advice) on a 500', () => {
    menuState.current = {
      isLoading: false,
      isError: true,
      error: { response: { status: 500 } },
    };
    render(<CostingPage />);
    expect(screen.getByText(/Rapor yüklenemedi/)).toBeTruthy();
    expect(screen.queryByText(/Gelişmiş Raporlar/)).toBeNull();
  });

  it('surfaces the uncosted-products count', () => {
    menuState.current = {
      isLoading: false,
      isError: false,
      data: { items: [], counts: { uncosted: 3 } },
    };
    render(<CostingPage />);
    expect(screen.getByText(/3 satılan ürünün maliyeti tanımlı değil/)).toBeTruthy();
  });
});
