import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useBranchScopeStore } from '../../store/branchScopeStore';

const h = vi.hoisted(() => ({
  branches: { data: [] as unknown[], isLoading: false },
  hasFeature: vi.fn(() => true),
  navigate: vi.fn(),
  location: { pathname: '/admin/reports', search: '', hash: '' },
}));

vi.mock('../../features/branches/branchesApi', () => ({
  useListBranches: () => h.branches,
}));
vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: h.hasFeature }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => h.navigate,
  useLocation: () => h.location,
}));

import BranchPicker from './BranchPicker';

const branch = (id: string, name: string) => ({ id, name, status: 'active' });

beforeEach(() => {
  useBranchScopeStore.getState().clear();
  localStorage.clear();
  h.navigate.mockReset();
  h.location = { pathname: '/admin/reports', search: '', hash: '' };
  h.hasFeature.mockReturnValue(true);
  h.branches.data = [branch('b-1', 'Kadıköy'), branch('b-2', 'Beşiktaş')];
  h.branches.isLoading = false;
  useBranchScopeStore.setState({
    branchId: 'b-1',
    allowedBranchIds: [],
    isPinned: false,
    // Default fixture represents a wildcard ADMIN (empty allow-list +
    // wildcard) — the pre-fix implicit assumption every other test in
    // this file relies on. The "isWildcard" describe block below covers
    // the non-wildcard empty-list case explicitly.
    isWildcard: true,
    tenantId: 't-1',
    branchChosen: true,
  });
});

const renderPicker = () =>
  render(
    <MemoryRouter>
      <BranchPicker />
    </MemoryRouter>,
  );

describe('BranchPicker (navbar switch button)', () => {
  it('shows the active branch and a switch-branch button', () => {
    renderPicker();
    expect(screen.getByText('Kadıköy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Switch branch/ })).toBeInTheDocument();
  });

  it('navigates to /branch-select carrying the current path', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /Switch branch/ }));
    expect(h.navigate).toHaveBeenCalledWith('/branch-select', {
      state: { from: '/admin/reports' },
    });
  });

  it('carries the query string and hash so the switcher returns to the exact view', () => {
    h.location = { pathname: '/admin/store', search: '?tab=hardware&sku=X', hash: '#top' };
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /Switch branch/ }));
    expect(h.navigate).toHaveBeenCalledWith('/branch-select', {
      state: { from: '/admin/store?tab=hardware&sku=X#top' },
    });
  });

  it('hides itself for single-branch tenants', () => {
    h.branches.data = [branch('b-1', 'Kadıköy')];
    renderPicker();
    expect(screen.queryByRole('button', { name: /Switch branch/ })).not.toBeInTheDocument();
  });

  it('renders the locked badge (no switch button) for pinned roles', () => {
    useBranchScopeStore.setState({ isPinned: true, allowedBranchIds: ['b-1'] });
    renderPicker();
    expect(screen.getByText('Kadıköy')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch branch/ })).not.toBeInTheDocument();
  });

  /**
   * Backend BranchGuard's wildcard rule is ADMIN-only: an empty
   * allowedBranchIds means "all branches" ONLY when the role is ADMIN
   * (isWildcard). A MANAGER whose allow-list is ever empty (a data bug)
   * must NOT be shown every branch — the backend would 403 them on all
   * of it. The store's `isWildcard` flag (computed in hydrateFromUser)
   * is the single source of truth this component reads.
   */
  describe('wildcard vs non-wildcard empty allow-list', () => {
    it('a non-wildcard user with an empty allow-list sees 0 switchable branches (picker hidden)', () => {
      useBranchScopeStore.setState({ allowedBranchIds: [], isWildcard: false });
      renderPicker();
      expect(screen.queryByRole('button', { name: /Switch branch/ })).not.toBeInTheDocument();
      expect(screen.queryByText('Kadıköy')).not.toBeInTheDocument();
      expect(screen.queryByText('Beşiktaş')).not.toBeInTheDocument();
    });

    it('a wildcard ADMIN with an empty allow-list sees every branch', () => {
      useBranchScopeStore.setState({ allowedBranchIds: [], isWildcard: true });
      renderPicker();
      expect(screen.getByText('Kadıköy')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Switch branch/ })).toBeInTheDocument();
    });
  });
});
