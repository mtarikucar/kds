import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  ImageOff,
  Pencil,
  Plus,
  Search,
} from 'lucide-react';
import {
  useReorderCategories,
  useReorderProducts,
} from '../../../features/menu/menuApi';
import type { Category, Product } from '../../../types';
import { getImageUrl } from './imageUrl';
import { reorder } from './reorder';
import { cn } from '../../../lib/utils';

const UNCATEGORIZED = '__uncategorized__';

interface Props {
  categories: Category[];
  products: Product[];
  selectedProductId?: string | null;
  onSelectProduct: (product: Product) => void;
  onAddProduct: (categoryId: string) => void;
  onEditCategory: (category: Category) => void;
  onAddCategory: () => void;
  canAddProduct: boolean;
  canAddCategory: boolean;
}

/**
 * The menu's spine: categories with their products, always visible while you
 * edit on the right.
 *
 * Deliberately compact. It used to be full-width cards that pushed the actual
 * work — photo, options, collections — onto other tabs and other routes; here
 * the list is a place to NAVIGATE, and everything you can change about a
 * product lives in one panel next to it. A product with no photo says so,
 * because the whole point of the menu is what the guest sees.
 */
export default function MenuTree({
  categories,
  products,
  selectedProductId,
  onSelectProduct,
  onAddProduct,
  onEditCategory,
  onAddCategory,
  canAddProduct,
  canAddCategory,
}: Props) {
  const { t } = useTranslation(['menu', 'common']);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { mutate: reorderCategories } = useReorderCategories();
  const { mutate: reorderProducts } = useReorderProducts();

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.displayOrder - b.displayOrder),
    [categories],
  );

  const byCategory = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const product of products) {
      const key = product.categoryId ?? UNCATEGORIZED;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(product);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    }
    return map;
  }, [products]);

  const term = search.trim().toLocaleLowerCase('tr');
  const matches = (product: Product) =>
    !term || product.name.toLocaleLowerCase('tr').includes(term);

  // Searching collapses nothing and hides nothing structural: a category whose
  // products all filter out simply shows none, so the operator keeps their
  // bearings instead of watching the tree reshape under them.
  const visibleFor = (categoryId: string) =>
    (byCategory.get(categoryId) ?? []).filter(matches);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onDragEnd = (result: DropResult) => {
    const { source, destination, type } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return;
    }

    if (type === 'category') {
      // The API takes the ordered id list and derives displayOrder itself.
      const next = reorder(sortedCategories, source.index, destination.index);
      reorderCategories(next.map((c) => c.id));
      return;
    }

    // Products reorder within their own category only; moving between
    // categories is a product edit (categoryId), not a drag.
    if (source.droppableId !== destination.droppableId) return;
    const list = byCategory.get(source.droppableId) ?? [];
    const next = reorder(list, source.index, destination.index);
    reorderProducts(next.map((p) => p.id));
  };

  const uncategorized = visibleFor(UNCATEGORIZED);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('menu.searchProducts', { defaultValue: 'Ürün ara…' })}
            className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="categories" type="category">
            {(dropCategories) => (
              <div
                ref={dropCategories.innerRef}
                {...dropCategories.droppableProps}
              >
                {sortedCategories.map((category, categoryIndex) => {
                  const items = visibleFor(category.id);
                  const isCollapsed = collapsed.has(category.id) && !term;
                  return (
                    <Draggable
                      key={category.id}
                      draggableId={category.id}
                      index={categoryIndex}
                    >
                      {(dragCategory) => (
                        <div
                          ref={dragCategory.innerRef}
                          {...dragCategory.draggableProps}
                          className="border-b border-slate-100 last:border-0"
                        >
                          <div className="group flex items-center gap-1 px-2 py-2">
                            <span
                              {...dragCategory.dragHandleProps}
                              className="cursor-grab text-slate-300 hover:text-slate-500"
                              aria-label={t('menu.reorder', {
                                defaultValue: 'Sırala',
                              })}
                            >
                              <GripVertical className="h-4 w-4" />
                            </span>
                            <button
                              type="button"
                              onClick={() => toggle(category.id)}
                              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                            >
                              {isCollapsed ? (
                                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                              ) : (
                                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                              )}
                              <span className="truncate text-sm font-semibold text-slate-800">
                                {category.name}
                              </span>
                              <span className="shrink-0 text-xs text-slate-400">
                                ({items.length})
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onEditCategory(category)}
                              title={t('menu.editCategory', {
                                defaultValue: 'Kategoriyi düzenle',
                              })}
                              className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onAddProduct(category.id)}
                              disabled={!canAddProduct}
                              title={t('menu.addProductToCategory', {
                                defaultValue: 'Bu kategoriye ürün ekle',
                              })}
                              className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-primary-600 group-hover:opacity-100 disabled:opacity-30"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>

                          {!isCollapsed && (
                            <Droppable droppableId={category.id} type="product">
                              {(dropProducts) => (
                                <div
                                  ref={dropProducts.innerRef}
                                  {...dropProducts.droppableProps}
                                  className="pb-1"
                                >
                                  {items.length === 0 ? (
                                    <p className="px-9 pb-2 text-xs text-slate-400">
                                      {term
                                        ? t('menu.noMatch', {
                                            defaultValue: 'Eşleşme yok',
                                          })
                                        : t('menu.categoryEmpty', {
                                            defaultValue: 'Henüz ürün yok',
                                          })}
                                    </p>
                                  ) : (
                                    items.map((product, productIndex) => (
                                      <Draggable
                                        key={product.id}
                                        draggableId={product.id}
                                        index={productIndex}
                                        isDragDisabled={!!term}
                                      >
                                        {(dragProduct) => (
                                          <div
                                            ref={dragProduct.innerRef}
                                            {...dragProduct.draggableProps}
                                            {...dragProduct.dragHandleProps}
                                          >
                                            <ProductRow
                                              product={product}
                                              selected={
                                                product.id === selectedProductId
                                              }
                                              onSelect={() =>
                                                onSelectProduct(product)
                                              }
                                            />
                                          </div>
                                        )}
                                      </Draggable>
                                    ))
                                  )}
                                  {dropProducts.placeholder}
                                </div>
                              )}
                            </Droppable>
                          )}
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {dropCategories.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>

        {/* Products whose category was deleted still sell; hiding them here
            would make them unfindable in the only screen that edits them. */}
        {uncategorized.length > 0 && (
          <div className="border-t border-slate-100">
            <div className="px-3 py-2 text-sm font-semibold text-slate-500">
              {t('menu.uncategorized', { defaultValue: 'Kategorisiz' })}
              <span className="ml-1 text-xs font-normal text-slate-400">
                ({uncategorized.length})
              </span>
            </div>
            {uncategorized.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                selected={product.id === selectedProductId}
                onSelect={() => onSelectProduct(product)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-2">
        <button
          type="button"
          onClick={onAddCategory}
          disabled={!canAddCategory}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-sm font-medium text-slate-600 hover:border-primary-400 hover:text-primary-600 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          {t('menu.addCategory')}
        </button>
      </div>
    </div>
  );
}

function ProductRow({
  product,
  selected,
  onSelect,
}: {
  product: Product;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation(['menu']);
  const thumb = product.images?.[0]?.url ?? product.image ?? null;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
        selected
          ? 'bg-primary-50 ring-1 ring-inset ring-primary-200'
          : 'hover:bg-slate-50',
      )}
    >
      <div className="h-8 w-8 shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-50">
        {thumb ? (
          <img
            src={getImageUrl(thumb)}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-slate-300"
            // A missing photo is the most common reason a menu looks bad, so
            // it is called out in the list rather than discovered per product.
            title={t('menu.noPhoto')}
          >
            <ImageOff className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm',
          selected ? 'font-medium text-primary-900' : 'text-slate-700',
        )}
      >
        {product.name}
      </span>
      {!product.isAvailable && (
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
          {t('menu.closed')}
        </span>
      )}
      <span className="shrink-0 text-xs tabular-nums text-slate-500">
        ₺{Number(product.price).toLocaleString('tr-TR')}
      </span>
    </button>
  );
}
