import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import i18next from 'i18next';
import enStock from '../../../i18n/locales/en/stock.json';
import { StockUnit, type StockItem } from '../types';

const categories: { data: any[] } = { data: [] };
const createCategory = { mutateAsync: vi.fn(), isPending: false };
const updateCategory = { mutateAsync: vi.fn(), isPending: false };
const deleteCategory = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../stockManagementApi', () => ({
  useStockCategories: () => categories,
  useCreateStockCategory: () => createCategory,
  useUpdateStockCategory: () => updateCategory,
  useDeleteStockCategory: () => deleteCategory,
}));

import StockItemForm from './StockItemForm';

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', enStock, true, true);
});

beforeEach(() => {
  categories.data = [];
  createCategory.mutateAsync.mockReset();
});

function makeItem(over: Partial<StockItem> = {}): StockItem {
  return {
    id: 'i1',
    name: 'Tomato',
    sku: 'TOM',
    unit: StockUnit.KG,
    description: '',
    currentStock: 5,
    minStock: 1,
    costPerUnit: 2,
    trackExpiry: false,
    categoryId: null,
    category: null,
    isActive: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  } as unknown as StockItem;
}

describe('StockItemForm', () => {
  it('renders the create title for a new item', () => {
    render(
      <StockItemForm item={null} onSave={() => {}} onClose={() => {}} isLoading={false} />,
    );
    expect(
      screen.getByRole('heading', { name: 'Add Ingredient' }),
    ).toBeInTheDocument();
  });

  it('renders the edit title and pre-fills the name when editing', () => {
    render(
      <StockItemForm item={makeItem()} onSave={() => {}} onClose={() => {}} isLoading={false} />,
    );
    expect(
      screen.getByRole('heading', { name: 'Edit Ingredient' }),
    ).toBeInTheDocument();
    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!;
    const nameInput = within(form).getAllByRole('textbox')[0] as HTMLInputElement;
    expect(nameInput.value).toBe('Tomato');
  });

  it('submits the form data with categoryId coalesced to undefined when empty', () => {
    const onSave = vi.fn();
    render(
      <StockItemForm item={null} onSave={onSave} onClose={() => {}} isLoading={false} />,
    );
    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!;
    const nameInput = within(form).getAllByRole('textbox')[0];
    fireEvent.change(nameInput, { target: { value: 'Basil' } });
    fireEvent.submit(form);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: 'Basil',
      unit: StockUnit.KG,
      categoryId: undefined,
    });
  });

  it('opens the inline category create form', () => {
    render(
      <StockItemForm item={null} onSave={() => {}} onClose={() => {}} isLoading={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add Category/i }));
    expect(
      screen.getByPlaceholderText(/Category name|Name/i),
    ).toBeInTheDocument();
  });

  it('calls onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <StockItemForm item={null} onSave={() => {}} onClose={onClose} isLoading={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
