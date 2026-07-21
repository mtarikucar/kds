import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useBranchScopeStore } from '../../store/branchScopeStore';

const h = vi.hoisted(() => ({
  branches: { data: [] as unknown[], isLoading: false },
  hasFeature: vi.fn(() => true),
}));

vi.mock('../../features/branches/branchesApi', () => ({
  useListBranches: () => h.branches,
}));
vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: h.hasFeature }),
}));

import BranchSelectionGate from './BranchSelectionGate';

const branch = (id: string, status = 'active') => ({ id, name: id, status });

const renderGate = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <BranchSelectionGate>
              <div>APP CONTENT</div>
            </BranchSelectionGate>
          }
        />
        <Route path="/branch-select" element={<div>SELECT SCREEN</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  useBranchScopeStore.getState().clear();
  localStorage.clear();
  h.branches.data = [branch('b-1'), branch('b-2')];
  h.branches.isLoading = false;
  h.hasFeature.mockReturnValue(true);
  useBranchScopeStore.setState({
    branchId: 'b-1',
    allowedBranchIds: [],
    isPinned: false,
    tenantId: 't-1',
    branchChosen: false,
  });
});

describe('BranchSelectionGate', () => {
  it('redirects a multi-branch user with no explicit choice to /branch-select', () => {
    renderGate();
    expect(screen.getByText('SELECT SCREEN')).toBeInTheDocument();
  });

  it('renders the app when the branch was already chosen', () => {
    useBranchScopeStore.setState({ branchChosen: true });
    renderGate();
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });

  it('renders the app for single-branch tenants', () => {
    h.branches.data = [branch('b-1')];
    renderGate();
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });

  it('ignores non-active branches when counting', () => {
    h.branches.data = [branch('b-1'), branch('b-2', 'archived')];
    renderGate();
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });

  it('renders the app for pinned roles', () => {
    useBranchScopeStore.setState({ isPinned: true });
    renderGate();
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });

  it('renders the app while the branch list is still loading (no flash-redirect)', () => {
    h.branches.data = [];
    h.branches.isLoading = true;
    renderGate();
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });

  it('renders the app when the tenant lacks multiLocation', () => {
    h.hasFeature.mockReturnValue(false);
    renderGate();
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });

  it('respects the allow-list when counting visible branches', () => {
    h.branches.data = [branch('b-1'), branch('b-2'), branch('b-3')];
    useBranchScopeStore.setState({ allowedBranchIds: ['b-2'] });
    renderGate();
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });
});
