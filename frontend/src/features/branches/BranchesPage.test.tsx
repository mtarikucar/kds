import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  branches: { data: [] as any[], isLoading: false },
  // v3.3.0 — branch capacity comes from the folded entitlement set (the same
  // number the server enforces inside the create transaction) rather than a
  // separate usage endpoint that no longer exists.
  cap: 1 as number,
  create: { mutate: vi.fn(), isPending: false },
}));
vi.mock('./branchesApi', () => ({
  useBranchOverview: () => h.branches,
  useCreateBranch: () => h.create,
}));
vi.mock('../../contexts/SubscriptionContext', () => ({
  useEntitlements: () => ({
    checkLimit: (_key: string, current: number) =>
      h.cap === -1
        ? { allowed: true, current, limit: -1, remaining: Infinity }
        : {
            allowed: current < h.cap,
            current,
            limit: h.cap,
            remaining: Math.max(0, h.cap - current),
          },
  }),
}));

import BranchesPage from './BranchesPage';

// The at-limit upsell renders a react-router <Link>, so the page needs a
// Router context.
const renderPage = () =>
  render(
    <MemoryRouter>
      <BranchesPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  h.branches.data = [];
  h.branches.isLoading = false;
  h.cap = 10;
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
        isHeadquarters: true,
        createdAt: '2024-01-01T00:00:00Z',
        devices: { total: 2, online: 1, pending: 0 },
        bridges: 1,
      },
    ];
    renderPage();
    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.getByText('IST-01')).toBeInTheDocument();
  });

  it('submits a new branch via the create mutation', () => {
    renderPage();
    const nameInput = screen.getAllByRole('textbox')[0];
    fireEvent.change(nameInput, { target: { value: 'Kadikoy' } });
    fireEvent.submit(nameInput.closest('form')!);
    expect(h.create.mutate).toHaveBeenCalledTimes(1);
    expect(h.create.mutate.mock.calls[0][0]).toMatchObject({ name: 'Kadikoy' });
  });

  it('does not submit when the name is empty', () => {
    renderPage();
    const form = screen.getAllByRole('textbox')[0].closest('form')!;
    fireEvent.submit(form);
    expect(h.create.mutate).not.toHaveBeenCalled();
  });

  it('disables the add button and shows the hint when at the branch limit', () => {
    h.cap = 1;
    h.branches.data = [
      { id: 'b1', name: 'Main', status: 'active', devices: { total: 0, online: 0, pending: 0 }, bridges: 0, createdAt: '2024-01-01T00:00:00Z' },
    ];
    renderPage();
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
    h.cap = -1;
    renderPage();
    expect(
      screen.queryByTestId('branches-at-limit-hint'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('branches-usage')).toBeInTheDocument();
  });
});
