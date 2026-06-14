import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import enStock from '../../../i18n/locales/en/stock.json';

const wasteLogs: { data: any[]; isLoading: boolean } = { data: [], isLoading: false };
const stockItems = { data: [{ id: 's1', name: 'Flour', unit: 'KG' }] };
const createMutation = { mutateAsync: vi.fn(), isPending: false };
let lastParams: unknown = null;

vi.mock('../stockManagementApi', () => ({
  useWasteLogs: (params: unknown) => {
    lastParams = params;
    return wasteLogs;
  },
  useStockItems: () => stockItems,
  useCreateWasteLog: () => createMutation,
}));

import WasteLogTab from './WasteLogTab';

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', enStock, true, true);
});

beforeEach(() => {
  wasteLogs.data = [];
  wasteLogs.isLoading = false;
  createMutation.mutateAsync.mockReset();
  lastParams = null;
});

describe('WasteLogTab', () => {
  it('shows the loading state', () => {
    wasteLogs.isLoading = true;
    render(<WasteLogTab />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    render(<WasteLogTab />);
    expect(screen.getByText('No waste logs found')).toBeInTheDocument();
  });

  it('renders a waste row with a negative quantity', () => {
    wasteLogs.data = [
      {
        id: 'w1',
        reason: 'SPOILED',
        quantity: 2,
        cost: 4.5,
        notes: 'fridge failure',
        createdAt: new Date().toISOString(),
        stockItem: { name: 'Milk', unit: 'L' },
      },
    ];
    render(<WasteLogTab />);
    const row = screen.getByText('Milk').closest('tr')!;
    expect(within(row).getByText(/-2\.000/)).toBeInTheDocument();
  });

  it('passes the selected reason filter to the query', () => {
    render(<WasteLogTab />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'EXPIRED' } });
    expect(lastParams).toMatchObject({ reason: 'EXPIRED' });
  });

  it('opens the waste form and submits via createMutation', async () => {
    createMutation.mutateAsync.mockResolvedValue({});
    render(<WasteLogTab />);
    fireEvent.click(screen.getByRole('button', { name: /Log Waste|Add Waste/i }));

    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!;
    const itemSelect = within(form).getAllByRole('combobox')[0];
    fireEvent.change(itemSelect, { target: { value: 's1' } });
    const qty = within(form).getByRole('spinbutton');
    fireEvent.change(qty, { target: { value: '2' } });

    fireEvent.submit(form);
    await waitFor(() =>
      expect(createMutation.mutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(createMutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ stockItemId: 's1', quantity: 2 }),
    );
  });
});
