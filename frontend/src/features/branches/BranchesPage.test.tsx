import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  branches: { data: [] as any[], isLoading: false },
  snapshot: { data: undefined as any },
  create: { mutate: vi.fn(), isPending: false },
}));
vi.mock('./branchesApi', () => ({
  useListBranches: () => h.branches,
  useCreateBranch: () => h.create,
}));
vi.mock('../plan/planApi', () => ({
  useGetUsageSnapshot: () => h.snapshot,
}));

import BranchesPage from './BranchesPage';

beforeEach(() => {
  h.branches.data = [];
  h.branches.isLoading = false;
  h.snapshot.data = undefined;
  h.create.mutate = vi.fn();
  h.create.isPending = false;
});

describe('BranchesPage', () => {
  it('renders existing branch rows', () => {
    h.branches.data = [
      {
        id: 'b1',
        name: 'Main',
        code: 'IST-01',
        timezone: 'Europe/Istanbul',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ];
    render(<BranchesPage />);
    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.getByText('IST-01')).toBeInTheDocument();
  });

  it('submits a new branch via the create mutation', () => {
    render(<BranchesPage />);
    const nameInput = screen.getAllByRole('textbox')[0];
    fireEvent.change(nameInput, { target: { value: 'Kadikoy' } });
    fireEvent.submit(nameInput.closest('form')!);
    expect(h.create.mutate).toHaveBeenCalledTimes(1);
    expect(h.create.mutate.mock.calls[0][0]).toMatchObject({ name: 'Kadikoy' });
  });

  it('does not submit when the name is empty', () => {
    render(<BranchesPage />);
    const form = screen.getAllByRole('textbox')[0].closest('form')!;
    fireEvent.submit(form);
    expect(h.create.mutate).not.toHaveBeenCalled();
  });

  it('disables the add button and shows the hint when at the branch limit', () => {
    h.snapshot.data = { branches: { current: 2, max: 2 } };
    render(<BranchesPage />);
    expect(
      screen.getByTestId('branches-at-limit-hint'),
    ).toBeInTheDocument();
    // The add submit button is disabled at the cap.
    const addBtn = screen
      .getAllByRole('button')
      .find((b) => b.getAttribute('type') === 'submit')!;
    expect(addBtn).toBeDisabled();
  });

  it('treats max === -1 as unlimited (no at-limit hint)', () => {
    h.snapshot.data = { branches: { current: 5, max: -1 } };
    render(<BranchesPage />);
    expect(
      screen.queryByTestId('branches-at-limit-hint'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('branches-usage')).toBeInTheDocument();
  });
});
