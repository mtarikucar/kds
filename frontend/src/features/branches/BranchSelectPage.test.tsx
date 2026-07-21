import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import { UserRole } from '../../types';
import type { Branch } from './branchesApi';

const h = vi.hoisted(() => ({
  branches: { data: [] as unknown[], isLoading: false },
  navigate: vi.fn(),
  locationState: null as { from?: string } | null,
  user: { role: 'ADMIN' } as { role: string } | null,
}));

vi.mock('./branchesApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./branchesApi')>()),
  useListBranches: () => h.branches,
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
  useLocation: () => ({ pathname: '/branch-select', state: h.locationState }),
}));
vi.mock('../../store/authStore', () => ({
  useAuthStore: (sel: (s: { user: unknown }) => unknown) => sel({ user: h.user }),
}));

import BranchSelectPage from './BranchSelectPage';

const mkBranch = (o: Partial<Branch>): Branch => ({
  id: 'b-1',
  tenantId: 't-1',
  name: 'Kadıköy',
  code: 'KDK',
  timezone: 'Europe/Istanbul',
  address: null,
  status: 'active',
  isHeadquarters: false,
  createdAt: '2026-01-01T00:00:00Z',
  ...o,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <BranchSelectPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  useBranchScopeStore.getState().clear();
  localStorage.clear();
  h.navigate.mockReset();
  h.locationState = null;
  h.user = { role: 'ADMIN' };
  h.branches.data = [
    mkBranch({ id: 'b-1', name: 'Kadıköy', isHeadquarters: true }),
    mkBranch({ id: 'b-2', name: 'Beşiktaş', code: 'BSK' }),
    mkBranch({ id: 'b-3', name: 'Depo', code: null, status: 'suspended' }),
  ];
  h.branches.isLoading = false;
  useBranchScopeStore.getState().hydrateFromUser({
    id: 'u-1',
    email: 'u@example.com',
    firstName: 'T',
    lastName: 'U',
    role: UserRole.ADMIN,
    tenantId: 't-1',
    primaryBranchId: 'b-1',
    allowedBranchIds: [],
  } as never);
});

describe('BranchSelectPage', () => {
  it('lists every visible branch with HQ badge', () => {
    renderPage();
    expect(screen.getByText('Kadıköy')).toBeInTheDocument();
    expect(screen.getByText('Beşiktaş')).toBeInTheDocument();
    expect(screen.getByText('Depo')).toBeInTheDocument();
    expect(screen.getByText('Headquarters')).toBeInTheDocument();
  });

  it('filters to the allow-list when one is present', () => {
    useBranchScopeStore.setState({ allowedBranchIds: ['b-2'] });
    renderPage();
    expect(screen.getByText('Beşiktaş')).toBeInTheDocument();
    expect(screen.queryByText('Kadıköy')).not.toBeInTheDocument();
  });

  it('selecting a branch stores it, marks it chosen and navigates back', () => {
    h.locationState = { from: '/admin/reports' };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Beşiktaş/ }));
    const s = useBranchScopeStore.getState();
    expect(s.branchId).toBe('b-2');
    expect(s.branchChosen).toBe(true);
    expect(h.navigate).toHaveBeenCalledWith('/admin/reports', { replace: true });
  });

  it('falls back to /dashboard when there is no origin', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Beşiktaş/ }));
    expect(h.navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('does not select a non-active branch', () => {
    renderPage();
    const suspended = screen.getByRole('button', { name: /Depo/ });
    expect(suspended).toBeDisabled();
    fireEvent.click(suspended);
    expect(useBranchScopeStore.getState().branchId).not.toBe('b-3');
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('shows the manage link for ADMIN', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /Manage Branches/ })).toHaveAttribute(
      'href',
      '/admin/branches',
    );
  });

  it('hides the manage link for non-admin roles', () => {
    h.user = { role: 'WAITER' };
    renderPage();
    expect(screen.queryByRole('link', { name: /Manage Branches/ })).not.toBeInTheDocument();
  });

  it('offers a back affordance only when a branch was already chosen (voluntary visit)', () => {
    useBranchScopeStore.setState({ branchChosen: true });
    renderPage();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('hides the back affordance in forced first-entry mode', () => {
    useBranchScopeStore.setState({ branchChosen: false });
    renderPage();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });
});
