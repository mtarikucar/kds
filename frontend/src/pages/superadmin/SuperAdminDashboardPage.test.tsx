import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  stats: { data: undefined as any, isLoading: false },
  growth: { data: undefined as any },
  alerts: { data: undefined as any },
  plans: { data: undefined as any },
}));
vi.mock('../../features/superadmin/api/superAdminApi', () => ({
  useDashboardStats: () => h.stats,
  useGrowthMetrics: () => h.growth,
  useDashboardAlerts: () => h.alerts,
  usePlanDistribution: () => h.plans,
}));

import SuperAdminDashboardPage from './SuperAdminDashboardPage';

function fullStats() {
  return {
    tenants: { total: 50, active: 40 },
    users: { total: 200 },
    revenue: { mrr: 12345 },
    orders: { total: 999 },
    subscriptions: { total: 36, active: 30, trial: 5, expired: 2, cancelled: 1 },
  };
}

beforeEach(() => {
  h.stats.data = undefined;
  h.stats.isLoading = false;
  h.growth.data = undefined;
  h.alerts.data = undefined;
  h.plans.data = undefined;
});

describe('SuperAdminDashboardPage', () => {
  it('shows a spinner while the stats query is loading', () => {
    h.stats.isLoading = true;
    const { container } = render(<SuperAdminDashboardPage />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders the metric cards from the stats payload', () => {
    h.stats.data = fullStats();
    render(<SuperAdminDashboardPage />);
    expect(
      screen.getByRole('heading', { name: 'dashboard.title' }),
    ).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument(); // total tenants
    expect(screen.getByText('₺12,345')).toBeInTheDocument(); // MRR formatted
  });

  it('renders alert banners when there are pending alerts', () => {
    h.stats.data = fullStats();
    h.alerts.data = {
      expiringTrials: 3,
      suspendedTenants: 0,
      failedPayments: 1,
    };
    render(<SuperAdminDashboardPage />);
    expect(
      screen.getByText('dashboard.alerts.expiringTrials'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('dashboard.alerts.failedPayments'),
    ).toBeInTheDocument();
    // suspendedTenants is 0 -> no banner for it
    expect(
      screen.queryByText('dashboard.alerts.suspendedTenants'),
    ).not.toBeInTheDocument();
  });

  it('omits the alerts section when all alert counts are zero', () => {
    h.stats.data = fullStats();
    h.alerts.data = {
      expiringTrials: 0,
      suspendedTenants: 0,
      failedPayments: 0,
    };
    render(<SuperAdminDashboardPage />);
    expect(
      screen.queryByText('dashboard.alerts.expiringTrials'),
    ).not.toBeInTheDocument();
  });
});
