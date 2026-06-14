import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import i18next from 'i18next';
import type { ReactNode } from 'react';
import menuEn from '../../../i18n/locales/en/menu.json';
import MenuTab from './MenuTab';

// Make the real menu strings resolvable so we can assert on the actual
// button label rather than an echoed i18n key.
beforeAll(() => {
  i18next.addResourceBundle('en', 'menu', menuEn, true, true);
});

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

// Minimal props for the empty-categories state (no DraggableCategoryCard
// renders, so this is a narrow gate test, not a full-tree mock).
const baseProps = {
  categories: [],
  products: [],
  isLoading: false,
  categoriesError: false,
  productsError: false,
  categoriesErrorObj: undefined,
  productsErrorObj: undefined,
  refetchCategories: vi.fn(),
  refetchProducts: vi.fn(),
  categoryLimit: { limit: -1 },
  productLimit: { limit: -1 },
  canAddCategory: true,
  canAddProduct: true,
  allCategoriesExpanded: true,
  onToggleExpandAll: vi.fn(),
  onAddCategory: vi.fn(),
  onEditCategory: vi.fn(),
  onDeleteCategory: vi.fn(),
  onAddProduct: vi.fn(),
  onEditProduct: vi.fn(),
  onDeleteProduct: vi.fn(),
};

describe('MenuTab limit gate', () => {
  it('enables the empty-state Add Category button when canAddCategory is true', () => {
    wrap(<MenuTab {...baseProps} canAddCategory />);
    const btn = screen.getByRole('button', { name: /Add Category/i });
    expect(btn).toBeEnabled();
  });

  it('disables the empty-state Add Category button when canAddCategory is false', () => {
    wrap(<MenuTab {...baseProps} canAddCategory={false} />);
    const btn = screen.getByRole('button', { name: /Add Category/i });
    expect(btn).toBeDisabled();
  });

  it('shows the loading spinner instead of the empty state while loading', () => {
    wrap(<MenuTab {...baseProps} isLoading />);
    expect(screen.queryByText(menuEn.menu.noCategories)).not.toBeInTheDocument();
  });
});
