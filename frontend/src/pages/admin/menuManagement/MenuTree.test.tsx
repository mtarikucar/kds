import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import MenuTree from './MenuTree';

/**
 * The menu's spine. What matters here is that nothing becomes unreachable:
 * a product whose category was deleted, a product that filters out of search,
 * a product with no photo. The old screen answered these across four tabs.
 */
const reorderCategories = vi.fn();
const reorderProducts = vi.fn();

vi.mock('../../../features/menu/menuApi', () => ({
  useReorderCategories: () => ({ mutate: reorderCategories }),
  useReorderProducts: () => ({ mutate: reorderProducts }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) =>
      typeof opts === 'object' && opts?.defaultValue ? opts.defaultValue : key,
  }),
}));
vi.mock('./imageUrl', () => ({ getImageUrl: (u: string) => u }));

const cat = (id: string, name: string, order: number) =>
  ({ id, name, displayOrder: order, isActive: true, tenantId: 't' }) as any;
const prod = (id: string, name: string, categoryId: string | null, over: any = {}) =>
  ({
    id,
    name,
    price: 100,
    categoryId,
    displayOrder: 0,
    isAvailable: true,
    images: [],
    ...over,
  }) as any;

const renderTree = (over: Partial<Parameters<typeof MenuTree>[0]> = {}) =>
  render(
    <MenuTree
      categories={[cat('c1', 'Başlangıçlar', 0), cat('c2', 'Ana Yemekler', 1)]}
      products={[
        prod('p1', 'Mercimek Çorbası', 'c1'),
        prod('p2', 'Adana Kebap', 'c2'),
      ]}
      selectedProductId={null}
      onSelectProduct={vi.fn()}
      onAddProduct={vi.fn()}
      onEditCategory={vi.fn()}
      onAddCategory={vi.fn()}
      canAddProduct
      canAddCategory
      {...(over as any)}
    />,
  );

beforeEach(() => {
  reorderCategories.mockReset();
  reorderProducts.mockReset();
});

describe('MenuTree', () => {
  it('groups products under their category with a count', () => {
    renderTree();
    expect(screen.getByText('Başlangıçlar')).toBeInTheDocument();
    expect(screen.getByText('Mercimek Çorbası')).toBeInTheDocument();
    expect(screen.getByText('Adana Kebap')).toBeInTheDocument();
  });

  it('selects a product on click', () => {
    const onSelectProduct = vi.fn();
    renderTree({ onSelectProduct });
    fireEvent.click(screen.getByText('Adana Kebap'));
    expect(onSelectProduct).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p2' }),
    );
  });

  it('filters by search without hiding the categories', () => {
    renderTree();
    fireEvent.change(screen.getByPlaceholderText('Ürün ara…'), {
      target: { value: 'adana' },
    });

    expect(screen.getByText('Adana Kebap')).toBeInTheDocument();
    expect(screen.queryByText('Mercimek Çorbası')).toBeNull();
    // The structure stays put so the operator keeps their bearings.
    expect(screen.getByText('Başlangıçlar')).toBeInTheDocument();
  });

  it('matches case- and diacritic-wise the way Turkish does', () => {
    renderTree({ products: [prod('p9', 'İskender', 'c2')] });
    fireEvent.change(screen.getByPlaceholderText('Ürün ara…'), {
      target: { value: 'isk' },
    });
    expect(screen.getByText('İskender')).toBeInTheDocument();
  });

  it('still lists a product whose category was deleted', () => {
    // Uncategorized products still sell. Dropping them from the only screen
    // that edits them would make them unfixable.
    renderTree({ products: [prod('p3', 'Yetim Ürün', null)] });
    expect(screen.getByText('Yetim Ürün')).toBeInTheDocument();
    // The heading is a label plus a count node; getAllByText matches the
    // heading and its wrapper, so assert presence rather than uniqueness.
    expect(
      screen.getAllByText((_, el) => el?.textContent?.startsWith('Kategorisiz') ?? false).length,
    ).toBeGreaterThan(0);
  });

  it('flags a product with no photo', () => {
    renderTree();
    expect(screen.getAllByTitle('menu.noPhoto').length).toBeGreaterThan(0);
  });

  it('shows a thumbnail when the product has one', () => {
    renderTree({
      products: [
        prod('p4', 'Künefe', 'c1', { images: [{ id: 'i1', url: '/x.jpg' }] }),
      ],
    });
    // alt="" makes the thumbnail presentational, so query the element itself.
    expect(document.querySelector('img[src="/x.jpg"]')).not.toBeNull();
  });

  it('marks an unavailable product', () => {
    renderTree({
      products: [prod('p5', 'Kapalı Ürün', 'c1', { isAvailable: false })],
    });
    expect(screen.getByText('menu.closed')).toBeInTheDocument();
  });

  it('collapses a category without losing its products', () => {
    renderTree();
    fireEvent.click(screen.getByText('Başlangıçlar'));
    expect(screen.queryByText('Mercimek Çorbası')).toBeNull();

    fireEvent.click(screen.getByText('Başlangıçlar'));
    expect(screen.getByText('Mercimek Çorbası')).toBeInTheDocument();
  });

  it('adds a product straight into the category it was clicked from', () => {
    const onAddProduct = vi.fn();
    renderTree({ onAddProduct });
    const header = screen.getByText('Ana Yemekler').closest('div')!;
    fireEvent.click(
      within(header).getByTitle('Bu kategoriye ürün ekle'),
    );
    expect(onAddProduct).toHaveBeenCalledWith('c2');
  });

  it('disables adding when the plan cap is reached', () => {
    renderTree({ canAddProduct: false, canAddCategory: false });
    expect(screen.getAllByTitle('Bu kategoriye ürün ekle')[0]).toBeDisabled();
    expect(screen.getByText('menu.addCategory').closest('button')).toBeDisabled();
  });
});
