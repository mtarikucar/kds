import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AttentionCard from './AttentionCard';

vi.mock('../../stock-management/stockManagementApi', () => ({
  useLowStockItems: () => globalThis.__lowStock,
}));
vi.mock('../../analytics/analyticsApi', () => ({
  useActionableInsights: () => globalThis.__insights,
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: (k: string) => globalThis.__features.includes(k) }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

declare global {
  /* eslint-disable no-var */
  var __lowStock: any;
  var __insights: any;
  var __features: string[];
  /* eslint-enable no-var */
}

const ok = (data: unknown) => ({ data, isLoading: false, isError: false });
const renderCard = () =>
  render(
    <MemoryRouter>
      <AttentionCard />
    </MemoryRouter>,
  );

describe('AttentionCard', () => {
  it('renders nothing when neither gate is granted', () => {
    globalThis.__features = [];
    const { container } = renderCard();
    expect(container.firstChild?.firstChild ?? null).toBeNull();
  });

  it('shows top-5 low stock rows when inventoryTracking is granted', () => {
    globalThis.__features = ['inventoryTracking'];
    globalThis.__lowStock = ok(
      Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, name: `Item${i}`, currentStock: 1, minStock: 5, unit: 'kg' })),
    );
    renderCard();
    expect(screen.getAllByTestId('low-stock-row')).toHaveLength(5);
    expect(screen.getByText('Item0')).toBeInTheDocument();
    expect(screen.queryByText('Item5')).not.toBeInTheDocument();
  });

  it('shows top-3 insights with severity dots when advancedReports is granted', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__insights = ok([
      { id: 'i1', title: 'Critical thing', severity: 'CRITICAL' },
      { id: 'i2', title: 'Warn thing', severity: 'WARNING' },
      { id: 'i3', title: 'Info thing', severity: 'INFO' },
      { id: 'i4', title: 'Overflow', severity: 'INFO' },
    ]);
    renderCard();
    expect(screen.getAllByTestId('insight-row')).toHaveLength(3);
    expect(screen.queryByText('Overflow')).not.toBeInTheDocument();
  });

  it('shows all-clear when both sections are entitled but empty', () => {
    globalThis.__features = ['inventoryTracking', 'advancedReports'];
    globalThis.__lowStock = ok([]);
    globalThis.__insights = ok([]);
    renderCard();
    expect(screen.getByTestId('widget-empty')).toHaveTextContent('dashboard.allClear');
  });
});
