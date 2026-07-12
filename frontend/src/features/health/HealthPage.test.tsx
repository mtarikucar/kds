import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import type { BranchHealth } from './healthApi';

// HealthPage is driven entirely by useGetHealthOverview + the two pure
// presentation helpers (pillClass / formatAge). We mock the query hook so
// each test pins one loading/empty/data branch and assert the rendered
// score, the pill colour class chosen by the pill, and the age strings the
// formatter produces.

let overview: {
  data?: BranchHealth[];
  isLoading: boolean;
  isError?: boolean;
  error?: unknown;
  refetch?: () => void;
};
vi.mock('./healthApi', () => ({
  useGetHealthOverview: () => overview,
}));

import HealthPage from './HealthPage';

function makeBranch(over: Partial<BranchHealth> = {}): BranchHealth {
  return {
    id: 'b-1',
    name: 'Kadıköy',
    health: {
      branchId: 'b-1',
      score: 87,
      pill: 'green',
      breakdown: {
        devicesOnlinePct: 92,
        fiscalAgeMinutes: 5,
        orderAgeMinutes: 130,
      },
      countedDevices: 4,
    },
    ...over,
  };
}

describe('HealthPage', () => {
  beforeEach(() => {
    overview = { data: [], isLoading: false };
  });

  it('shows the loading line while the overview query is pending', () => {
    overview = { data: undefined, isLoading: true };
    render(<HealthPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    // No branch cards while loading.
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no active branches', () => {
    overview = { data: [], isLoading: false };
    render(<HealthPage />);
    expect(screen.getByText('No active branches.')).toBeInTheDocument();
  });

  it('renders one card per branch with the score and the green pill colour', () => {
    overview = { data: [makeBranch({ name: 'Kadıköy' })], isLoading: false };
    render(<HealthPage />);

    expect(screen.getByRole('heading', { name: 'Kadıköy' })).toBeInTheDocument();
    // Composite score, rendered split from "/ 100".
    expect(screen.getByText('87')).toBeInTheDocument();
    expect(screen.getByText('/ 100')).toBeInTheDocument();

    // The pill renders the translated label (en) and carries the green colour
    // classes resolved by pillClass('green').
    const pill = screen.getByText('Good');
    expect(pill.className).toContain('bg-green-100');
    expect(pill.className).toContain('text-green-800');
  });

  it('formats the breakdown ages via formatAge: minutes and hours', () => {
    overview = {
      data: [
        makeBranch({
          health: {
            branchId: 'b-1',
            score: 40,
            pill: 'yellow',
            breakdown: {
              devicesOnlinePct: 50,
              fiscalAgeMinutes: 5, // < 60 -> "5m"
              orderAgeMinutes: 130, // >= 60 -> round(130/60)=2 -> "2h"
            },
            countedDevices: 2,
          },
        }),
      ],
      isLoading: false,
    };
    render(<HealthPage />);

    const card = screen.getByRole('article');
    expect(within(card).getByText('50%')).toBeInTheDocument();
    expect(within(card).getByText('5m')).toBeInTheDocument();
    expect(within(card).getByText('2h')).toBeInTheDocument();
  });

  it('renders fiscal/order ages and a yellow pill with amber classes', () => {
    overview = {
      data: [
        makeBranch({
          health: {
            branchId: 'b-1',
            score: 55,
            pill: 'yellow',
            breakdown: {
              devicesOnlinePct: 73,
              fiscalAgeMinutes: 5, // "5m"
              orderAgeMinutes: null, // "—"
            },
            countedDevices: 3,
          },
        }),
      ],
      isLoading: false,
    };
    render(<HealthPage />);

    expect(screen.getByText('73%')).toBeInTheDocument();
    expect(screen.getByText('5m')).toBeInTheDocument();
    // null order age renders the em-dash from formatAge.
    expect(screen.getByText('—')).toBeInTheDocument();

    const pill = screen.getByText('Warning');
    expect(pill.className).toContain('bg-amber-100');
    expect(pill.className).toContain('text-amber-800');
  });

  it('uses the red pill classes for a red branch', () => {
    overview = { data: [makeBranch({ health: { ...makeBranch().health, pill: 'red' } })], isLoading: false };
    render(<HealthPage />);
    const pill = screen.getByText('Critical');
    expect(pill.className).toContain('bg-red-100');
    expect(pill.className).toContain('text-red-800');
  });

  it('shows an error state with a retry button when the overview query fails', () => {
    const refetch = vi.fn();
    overview = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      refetch,
    };
    render(<HealthPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
