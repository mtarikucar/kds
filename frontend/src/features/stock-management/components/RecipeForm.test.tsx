import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import enStock from '../../../i18n/locales/en/stock.json';

const apiGet = vi.fn();
vi.mock('../../../lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a) },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('../stockManagementApi', () => ({
  useStockItems: () => ({
    data: [
      { id: 's1', name: 'Flour', unit: 'KG' },
      { id: 's2', name: 'Sugar', unit: 'KG' },
    ],
  }),
}));

import RecipeForm from './RecipeForm';

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', enStock, true, true);
});

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue({ data: [{ id: 'p1', name: 'Pizza' }] });
});

describe('RecipeForm', () => {
  it('renders the create title and a product selector for a new recipe', async () => {
    render(
      <RecipeForm recipe={null} onSave={() => {}} onClose={() => {}} isLoading={false} />,
    );
    expect(
      screen.getByRole('heading', { name: 'Add Recipe' }),
    ).toBeInTheDocument();
    // products fetched on mount
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/menu/products'));
  });

  it('adds and removes ingredient rows', () => {
    render(
      <RecipeForm recipe={null} onSave={() => {}} onClose={() => {}} isLoading={false} />,
    );
    const addBtn = screen.getByRole('button', { name: /Add Ingredient/i });
    // starts with 1 ingredient select; the product select is also a combobox
    const before = screen.getAllByRole('combobox').length;
    fireEvent.click(addBtn);
    expect(screen.getAllByRole('combobox').length).toBe(before + 1);
  });

  it('submits the collected recipe data (including productId for new)', async () => {
    const onSave = vi.fn();
    render(
      <RecipeForm recipe={null} onSave={onSave} onClose={() => {}} isLoading={false} />,
    );
    await waitFor(() => expect(apiGet).toHaveBeenCalled());

    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!;
    const combos = within(form).getAllByRole('combobox');
    // first combobox = product, second = ingredient
    fireEvent.change(combos[0], { target: { value: 'p1' } });
    fireEvent.change(combos[1], { target: { value: 's1' } });
    const qty = within(form).getByPlaceholderText(/Quantity|quantity/i);
    fireEvent.change(qty, { target: { value: '2' } });

    fireEvent.submit(form);
    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.productId).toBe('p1');
    expect(payload.ingredients).toEqual([{ stockItemId: 's1', quantity: 2 }]);
  });

  it('omits productId and shows the edit title when editing', () => {
    const onSave = vi.fn();
    const recipe = {
      id: 'r1',
      productId: 'p9',
      name: 'Dough',
      notes: '',
      yield: 2,
      ingredients: [{ id: 'i1', stockItemId: 's2', quantity: 4 }],
    } as never;
    render(
      <RecipeForm recipe={recipe} onSave={onSave} onClose={() => {}} isLoading={false} />,
    );
    expect(
      screen.getByRole('heading', { name: /Edit Recipe/i }),
    ).toBeInTheDocument();
    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!;
    fireEvent.submit(form);
    expect(onSave.mock.calls[0][0].productId).toBeUndefined();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <RecipeForm recipe={null} onSave={() => {}} onClose={onClose} isLoading={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
