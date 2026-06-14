import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import enStock from '../../../i18n/locales/en/stock.json';

const recipes: { data: any[]; isLoading: boolean } = { data: [], isLoading: false };
const createMutation = { mutateAsync: vi.fn(), isPending: false };
const updateMutation = { mutateAsync: vi.fn(), isPending: false };
const deleteMutation = { mutateAsync: vi.fn() };
const checkStockMutation = { mutateAsync: vi.fn() };

vi.mock('../stockManagementApi', () => ({
  useRecipes: () => recipes,
  useCreateRecipe: () => createMutation,
  useUpdateRecipe: () => updateMutation,
  useDeleteRecipe: () => deleteMutation,
  useCheckRecipeStock: () => checkStockMutation,
  // RecipeForm (rendered when adding) reaches for these:
  useStockItems: () => ({ data: [], isLoading: false }),
}));
// RecipeForm is heavy; not under test here — stub it.
vi.mock('./RecipeForm', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="recipe-form">
      <button onClick={onClose}>close-form</button>
    </div>
  ),
}));

import RecipesTab from './RecipesTab';

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', enStock, true, true);
});

beforeEach(() => {
  recipes.data = [];
  recipes.isLoading = false;
  createMutation.mutateAsync.mockReset();
  updateMutation.mutateAsync.mockReset();
  deleteMutation.mutateAsync.mockReset();
  checkStockMutation.mutateAsync.mockReset();
  vi.restoreAllMocks();
});

function makeRecipe(over: Partial<any> = {}) {
  return {
    id: 'r1',
    name: 'Pizza Dough',
    yield: 4,
    product: { name: 'Pizza' },
    ingredients: [
      { id: 'i1', quantity: 2, stockItem: { name: 'Flour', unit: 'KG' } },
    ],
    ...over,
  };
}

describe('RecipesTab', () => {
  it('shows the loading state', () => {
    recipes.isLoading = true;
    render(<RecipesTab />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    render(<RecipesTab />);
    expect(screen.getByText('No recipes found')).toBeInTheDocument();
  });

  it('renders a recipe card with its name and ingredients', () => {
    recipes.data = [makeRecipe()];
    render(<RecipesTab />);
    expect(screen.getByText('Pizza Dough')).toBeInTheDocument();
    expect(screen.getByText('Flour')).toBeInTheDocument();
  });

  it('opens the form when the create button is clicked', () => {
    render(<RecipesTab />);
    fireEvent.click(screen.getByRole('button', { name: /Add Recipe|Create/i }));
    expect(screen.getByTestId('recipe-form')).toBeInTheDocument();
  });

  it('deletes a recipe only after confirm', async () => {
    recipes.data = [makeRecipe()];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RecipesTab />);
    const card = screen.getByText('Pizza Dough').closest('div')!.parentElement!
      .parentElement!;
    const buttons = within(card).getAllByRole('button');
    // Last action button is delete.
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(deleteMutation.mutateAsync).toHaveBeenCalledWith('r1'),
    );
  });

  it('runs a stock check and shows the result modal', async () => {
    recipes.data = [makeRecipe()];
    checkStockMutation.mutateAsync.mockResolvedValue({
      canProduce: true,
      maxQuantity: 5,
      ingredients: [
        { stockItemId: 's1', name: 'Flour', available: 10, required: 2, unit: 'KG', sufficient: true },
      ],
    });
    render(<RecipesTab />);
    const card = screen.getByText('Pizza Dough').closest('div')!.parentElement!
      .parentElement!;
    const buttons = within(card).getAllByRole('button');
    // First action button is "check stock".
    fireEvent.click(buttons[0]);
    await waitFor(() =>
      expect(checkStockMutation.mutateAsync).toHaveBeenCalledWith({ id: 'r1' }),
    );
    // Modal renders the canProduce verdict + max quantity from the result.
    expect(await screen.findByText(/Max producible/i)).toBeInTheDocument();
    expect(screen.getByText(/10\.0 \/ 2\.0 KG/)).toBeInTheDocument();
  });
});
