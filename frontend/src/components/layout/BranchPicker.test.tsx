import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useBranchScopeStore } from '../../store/branchScopeStore';

const h = vi.hoisted(() => ({
  branches: { data: [] as unknown[], isLoading: false },
  hasFeature: vi.fn(() => true),
  navigate: vi.fn(),
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
  useLocation: () => ({ pathname: '/admin/reports' }),
}));

import BranchPicker from './BranchPicker';

const branch = (id: string, name: string) => ({ id, name, status: 'active' });

beforeEach(() => {
  useBranchScopeStore.getState().clear();
  localStorage.clear();
  h.navigate.mockReset();
  h.hasFeature.mockReturnValue(true);
  h.branches.data = [branch('b-1', 'Kadıköy'), branch('b-2', 'Beşiktaş')];
  h.branches.isLoading = false;
  useBranchScopeStore.setState({
    branchId: 'b-1',
    allowedBranchIds: [],
    isPinned: false,
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
});
