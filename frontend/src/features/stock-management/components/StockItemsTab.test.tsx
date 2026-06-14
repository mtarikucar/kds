import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import enStock from '../../../i18n/locales/en/stock.json';
import { StockUnit, type StockItem } from '../types';

// StockItemsTab drives the ingredient table: low-stock flagging (isLowStock),
// the delete flow gated by window.confirm -> deleteMutation, and opening the
// StockItemForm to create (createMutation) or edit (updateMutation). We mock
// the whole stockManagementApi module so we can assert the exact mutation +
// payload, and register the `stock` namespace for real labels.

const items: { data: StockItem[]; isLoading: boolean } = { data: [], isLoading: false };
const categories: { data: any[] } = { data: [] };
const createMutation = { mutateAsync: vi.fn(), isPending: false };
const updateMutation = { mutateAsync: vi.fn(), isPending: false };
const deleteMutation = { mutateAsync: vi.fn() };

vi.mock('../stockManagementApi', () => ({
  useStockItems: () => items,
  useStockCategories: () => categories,
  useCreateStockItem: () => createMutation,
  useUpdateStockItem: () => updateMutation,
  useDeleteStockItem: () => deleteMutation,
  // StockItemForm (rendered real) also reaches for these category hooks:
  useCreateStockCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateStockCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteStockCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import StockItemsTab from './StockItemsTab';

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', enStock, true, true);
});

function makeItem(over: Partial<StockItem> = {}): StockItem {
  return {
    id: 'i-1',
    name: 'Tomato',
    sku: 'TOM-1',
    unit: StockUnit.KG,
    description: '',
    currentStock: 10,
    minStock: 2,
    costPerUnit: 1.5,
    trackExpiry: false,
    categoryId: null,
    category: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  } as unknown as StockItem;
}

describe('StockItemsTab', () => {
  beforeEach(() => {
    items.data = [];
    items.isLoading = false;
    categories.data = [];
    createMutation.mutateAsync.mockReset();
    createMutation.isPending = false;
    updateMutation.mutateAsync.mockReset();
    updateMutation.isPending = false;
    deleteMutation.mutateAsync.mockReset();
    vi.restoreAllMocks();
  });

  it('shows the loading state while the items query is pending', () => {
    items.isLoading = true;
    render(<StockItemsTab />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows the empty state when there are no items', () => {
    items.data = [];
    render(<StockItemsTab />);
    expect(screen.getByText('No ingredients found')).toBeInTheDocument();
  });

  it('flags a low-stock row (currentStock <= minStock) and styles the qty red', () => {
    items.data = [
      makeItem({ id: 'low', name: 'Onion', currentStock: 1, minStock: 2 }),
      makeItem({ id: 'ok', name: 'Garlic', currentStock: 9, minStock: 2 }),
    ];
    render(<StockItemsTab />);

    const lowRow = screen.getByText('Onion').closest('tr')!;
    // The qty cell carries the red class only on the low row.
    const lowQty = within(lowRow).getByText(/1\.0 kg/);
    expect(lowQty.className).toContain('text-red-600');

    const okRow = screen.getByText('Garlic').closest('tr')!;
    const okQty = within(okRow).getByText(/9\.0 kg/);
    expect(okQty.className).not.toContain('text-red-600');
  });

  it('deletes an item only after window.confirm returns true', async () => {
    items.data = [makeItem({ id: 'del-me', name: 'Pepper' })];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<StockItemsTab />);

    // The delete button is the second action button in the row.
    const row = screen.getByText('Pepper').closest('tr')!;
    const buttons = within(row).getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);

    expect(confirmSpy).toHaveBeenCalledWith('Delete this ingredient?');
    await waitFor(() => expect(deleteMutation.mutateAsync).toHaveBeenCalledWith('del-me'));
  });

  it('does NOT delete when window.confirm is cancelled', () => {
    items.data = [makeItem({ id: 'keep', name: 'Pepper' })];
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<StockItemsTab />);

    const row = screen.getByText('Pepper').closest('tr')!;
    const buttons = within(row).getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(deleteMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('opens the form for a NEW item and submits via createMutation', async () => {
    createMutation.mutateAsync.mockResolvedValue({});
    render(<StockItemsTab />);

    fireEvent.click(screen.getByRole('button', { name: /Add Ingredient/ }));
    // The modal title reflects create mode.
    expect(screen.getByRole('heading', { name: 'Add Ingredient' })).toBeInTheDocument();

    // Scope to the modal's <form> (the page toolbar also has a search
    // textbox). The name field has no htmlFor association; it is the first
    // text input inside the form. Fill it (required), then submit the form
    // directly (submitting the <form> exercises onSubmit — jsdom does not run
    // required-constraint validation on a programmatic button click).
    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!;
    const nameInput = within(form).getAllByRole('textbox')[0] as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Basil' } });
    expect(nameInput.value).toBe('Basil');

    fireEvent.submit(form);

    await waitFor(() => expect(createMutation.mutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutation.mutateAsync).not.toHaveBeenCalled();
    expect(createMutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Basil', unit: StockUnit.KG }),
    );
  });

  it('opens the form for an EXISTING item and submits via updateMutation with its id', async () => {
    updateMutation.mutateAsync.mockResolvedValue({});
    items.data = [makeItem({ id: 'item-7', name: 'Flour' })];
    render(<StockItemsTab />);

    // Edit button is the first action button in the row.
    const row = screen.getByText('Flour').closest('tr')!;
    const buttons = within(row).getAllByRole('button');
    fireEvent.click(buttons[0]);

    expect(screen.getByRole('heading', { name: 'Edit Ingredient' })).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);

    await waitFor(() => expect(updateMutation.mutateAsync).toHaveBeenCalledTimes(1));
    expect(createMutation.mutateAsync).not.toHaveBeenCalled();
    expect(updateMutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'item-7', data: expect.objectContaining({ name: 'Flour' }) }),
    );
  });

  it('filters the items query by the search input value', () => {
    render(<StockItemsTab />);
    const search = screen.getByPlaceholderText('Search ingredients...');
    fireEvent.change(search, { target: { value: 'tom' } });
    // The controlled input reflects the typed value (search state wired).
    expect((search as HTMLInputElement).value).toBe('tom');
  });
});
