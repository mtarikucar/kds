import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import enStock from '../../../i18n/locales/en/stock.json';

const movements: { data: any[]; isLoading: boolean } = { data: [], isLoading: false };
const stockItems = { data: [{ id: 's1', name: 'Flour' }] };
const createMutation = { mutateAsync: vi.fn(), isPending: false };
let lastMovementParams: unknown = null;

vi.mock('../stockManagementApi', () => ({
  useIngredientMovements: (params: unknown) => {
    lastMovementParams = params;
    return movements;
  },
  useStockItems: () => stockItems,
  useCreateMovement: () => createMutation,
}));

import MovementsTab from './MovementsTab';

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', enStock, true, true);
});

beforeEach(() => {
  movements.data = [];
  movements.isLoading = false;
  createMutation.mutateAsync.mockReset();
  lastMovementParams = null;
});

describe('MovementsTab', () => {
  it('shows the loading state', () => {
    movements.isLoading = true;
    render(<MovementsTab />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    render(<MovementsTab />);
    expect(screen.getByText('No movements found')).toBeInTheDocument();
  });

  it('renders a movement row with a signed quantity', () => {
    movements.data = [
      {
        id: 'm1',
        type: 'IN',
        quantity: 5,
        notes: 'restock',
        createdAt: new Date().toISOString(),
        stockItem: { name: 'Sugar', unit: 'KG' },
      },
    ];
    render(<MovementsTab />);
    // 'Sugar' is not in the filter dropdown (only Flour is), so the row name
    // is unambiguous; the signed quantity confirms the +/- formatting.
    const row = screen.getByText('Sugar').closest('tr')!;
    expect(within(row).getByText(/\+5\.000/)).toBeInTheDocument();
  });

  it('passes the selected type filter down to the query', () => {
    render(<MovementsTab />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'OUT' } });
    expect(lastMovementParams).toMatchObject({ type: 'OUT' });
  });

  it('opens the movement form and submits via createMutation', async () => {
    createMutation.mutateAsync.mockResolvedValue({});
    render(<MovementsTab />);
    fireEvent.click(screen.getByRole('button', { name: /Add Movement/i }));

    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!;
    // item select (required) + quantity (required)
    const itemSelect = within(form).getAllByRole('combobox')[0];
    fireEvent.change(itemSelect, { target: { value: 's1' } });
    const qty = within(form).getByRole('spinbutton');
    fireEvent.change(qty, { target: { value: '3' } });

    fireEvent.submit(form);
    await waitFor(() =>
      expect(createMutation.mutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(createMutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ stockItemId: 's1', quantity: 3 }),
    );
  });
});
