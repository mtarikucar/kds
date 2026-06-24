import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories } from '../../features/menu/menuApi';
import { useProducts } from '../../features/menu/menuApi';
import { useGetPosSettings } from '../../features/pos/posApi';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { Product } from '../../types';
import Spinner from '../ui/Spinner';
import { Plus, Minus, Grid3x3, List, Search, Package, AlertCircle, Sparkles } from 'lucide-react';

interface MenuPanelProps {
  onAddItem: (product: Product) => void;
  /**
   * Quantity of each product currently in the cart, keyed by product id.
   * When a product is present (>0) its card shows an in-cart badge with
   * inline +/- so quantity changes don't require opening the cart.
   */
  cartQuantities?: Record<string, number>;
  /** Increment a product already in the cart (no modal). */
  onIncrement?: (productId: string) => void;
  /** Decrement a product already in the cart (down to removal at 0). */
  onDecrement?: (productId: string) => void;
}

type ViewMode = 'grid' | 'list';

/**
 * Whether a product has at least one required modifier group. Mirrors the
 * detection in POSPage.handleAddItem so the card's inline-stepper decision
 * stays in sync with which products force the ProductOptionsModal path.
 */
const hasRequiredModifiers = (product: Product): boolean =>
  !!product.modifierGroups?.some(
    (group) => group.isRequired || group.minSelections > 0,
  );

const MenuPanel = ({
  onAddItem,
  cartQuantities = {},
  onIncrement,
  onDecrement,
}: MenuPanelProps) => {
  const { t } = useTranslation('pos');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const { data: products, isLoading: productsLoading } = useProducts({
    categoryId: selectedCategoryId || undefined,
    isAvailable: true,
  });
  const { data: posSettings } = useGetPosSettings();
  const formatPrice = useFormatCurrency();

  const showImages = posSettings?.showProductImages ?? true;

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    if (!searchQuery.trim()) return products;

    const query = searchQuery.toLowerCase().trim();
    return products.filter(product =>
      product.name.toLowerCase().includes(query) ||
      product.description?.toLowerCase().includes(query)
    );
  }, [products, searchQuery]);

  if (categoriesLoading) {
    return <Spinner />;
  }

  return (
    <div className="flex flex-col h-full bg-slate-50/50 rounded-xl">
      {/* Header Section */}
      <div className="p-3 sm:p-4 bg-white rounded-t-xl border-b border-slate-100 space-y-3 sm:space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('menu.searchProducts')}
            className="w-full pl-11 pr-4 py-3 border border-slate-200 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm shadow-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              ×
            </button>
          )}
        </div>

        {/* Category Chips & View Toggle */}
        <div className="flex items-center gap-3">
          {/* Category Chips - Horizontal Scroll */}
          <div className="flex gap-2 overflow-x-auto pb-2 flex-1 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
            <button
              onClick={() => setSelectedCategoryId('')}
              className={`px-4 py-2 rounded-full font-medium text-sm whitespace-nowrap flex-shrink-0 transition-all duration-200 ${
                !selectedCategoryId
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'bg-white border border-slate-200 text-slate-600 hover:border-primary-300 hover:text-primary-600'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4" />
                {t('common:all')}
              </span>
            </button>
            {categories?.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategoryId(category.id)}
                className={`px-4 py-2 rounded-full font-medium text-sm whitespace-nowrap flex-shrink-0 transition-all duration-200 ${
                  selectedCategoryId === category.id
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-600 hover:border-primary-300 hover:text-primary-600'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>

          {/* View Mode Toggle */}
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1 flex-shrink-0">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                viewMode === 'grid'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              aria-label={t('menu.gridView')}
              title={t('menu.gridView')}
            >
              <Grid3x3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-all duration-200 ${
                viewMode === 'list'
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              aria-label={t('menu.listView')}
              title={t('menu.listView')}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Products Grid/List */}
      <div className="flex-1 overflow-y-auto p-2.5 sm:p-4">
        {productsLoading ? (
          <div className="flex items-center justify-center h-64">
            <Spinner />
          </div>
        ) : filteredProducts.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <Package className="h-8 w-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-2">
              {searchQuery ? t('menu.noProductsFound') : t('menu.noProducts')}
            </h3>
            <p className="text-slate-500 text-sm">
              {searchQuery ? t('menu.tryDifferentSearch') : t('menu.selectDifferentCategory')}
            </p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="mt-4 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors shadow-sm"
              >
                {t('menu.clearSearch')}
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5 sm:gap-4">
            {filteredProducts.map((product) => {
              const inCartQty = cartQuantities[product.id] ?? 0;
              const requiresModifiers = hasRequiredModifiers(product);
              // The whole card is the add target (fast path) unless it's a
              // required-modifier item that's already in the cart — for those
              // the inline badge would be ambiguous about which modifier set
              // to bump, so we keep the explicit modal-opening add button.
              const cardActsAsAdd = product.currentStock !== 0;
              const showInlineSteppers =
                inCartQty > 0 && !requiresModifiers && !!onIncrement && !!onDecrement;

              return (
                <div
                  key={product.id}
                  role={cardActsAsAdd ? 'button' : undefined}
                  tabIndex={cardActsAsAdd ? 0 : undefined}
                  onClick={cardActsAsAdd ? () => onAddItem(product) : undefined}
                  onKeyDown={
                    cardActsAsAdd
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onAddItem(product);
                          }
                        }
                      : undefined
                  }
                  aria-label={cardActsAsAdd ? `${t('addToOrder')}: ${product.name}` : undefined}
                  className={`group relative bg-white rounded-xl border overflow-hidden transition-all duration-200 min-h-[44px] ${
                    inCartQty > 0 ? 'border-primary-300 ring-1 ring-primary-200' : 'border-slate-200/60'
                  } ${
                    cardActsAsAdd
                      ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none'
                      : 'opacity-60 cursor-not-allowed'
                  }`}
                >
                  {/* In-cart quantity badge */}
                  {inCartQty > 0 && (
                    <div className="absolute top-2 left-2 z-10 bg-primary-600 text-white text-xs font-bold rounded-full h-6 min-w-[1.5rem] px-1.5 flex items-center justify-center shadow ring-2 ring-white">
                      {inCartQty}
                    </div>
                  )}

                  {/* Image */}
                  <div className="aspect-[4/3] bg-slate-100 overflow-hidden relative">
                    {showImages && product.images && product.images.length > 0 ? (
                      <img
                        src={product.images[0].url.startsWith('http://') || product.images[0].url.startsWith('https://')
                          ? product.images[0].url
                          : `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${product.images[0].url}`}
                        alt={product.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-50">
                        <Package className="h-12 w-12 text-slate-300" />
                      </div>
                    )}

                    {/* Stock Badge */}
                    {product.currentStock !== null && product.currentStock <= 5 && (
                      <div className="absolute top-2 right-2">
                        <div className={`text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 ${
                          product.currentStock === 0 ? 'bg-red-500' : 'bg-amber-500'
                        }`}>
                          <AlertCircle className="h-3 w-3" />
                          {product.currentStock === 0 ? t('outOfStock') : product.currentStock}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Content. Footer STACKS on narrow phones (2-col cards are
                      ~115px wide — price + a 2-button stepper can't share a
                      row without clipping) and becomes a compact side-by-side
                      row from sm up. */}
                  <div className="p-2.5 sm:p-4">
                    <h3 className="font-semibold text-slate-900 truncate text-sm sm:text-base">{product.name}</h3>
                    {product.description && (
                      <p className="text-xs sm:text-sm text-slate-500 mt-0.5 sm:mt-1 line-clamp-1">{product.description}</p>
                    )}
                    <div className="mt-2 sm:mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-primary-600 font-bold text-base sm:text-lg leading-tight">{formatPrice(product.price)}</p>
                      {showInlineSteppers ? (
                        /* Inline +/- stepper for an in-cart item (no modal).
                           Full-width on mobile (− and + pinned to the edges),
                           compact on sm+. */
                        <div
                          className="flex items-center justify-between sm:justify-start gap-1 bg-white rounded-lg border border-slate-200 p-0.5 w-full sm:w-auto"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => onDecrement!(product.id)}
                            aria-label={t('menu.decrease', 'Azalt')}
                            className="h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-md hover:bg-slate-100 transition-colors text-slate-600"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="flex-1 sm:flex-none sm:w-6 text-center font-semibold text-sm text-slate-900 tabular-nums">
                            {inCartQty}
                          </span>
                          <button
                            type="button"
                            onClick={() => onIncrement!(product.id)}
                            aria-label={t('menu.increase', 'Artır')}
                            className="h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-md hover:bg-slate-100 transition-colors text-slate-600"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        /* Add affordance: full-width with an "Ekle" label on
                           mobile (clearer + easier to tap), compact square on sm+. */
                        <span
                          className={`flex items-center justify-center gap-1.5 rounded-lg transition-all duration-200 w-full h-10 sm:w-auto sm:h-auto sm:min-h-[44px] sm:min-w-[44px] sm:p-2 ${
                            product.currentStock === 0
                              ? 'bg-slate-100 text-slate-400'
                              : 'bg-primary-500 text-white group-hover:bg-primary-600 shadow-sm'
                          }`}
                          aria-hidden="true"
                        >
                          <Plus className="h-5 w-5" />
                          <span className="sm:hidden text-sm font-semibold">{t('add', 'Ekle')}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List View */
          <div className="space-y-3">
            {filteredProducts.map((product) => {
              const inCartQty = cartQuantities[product.id] ?? 0;
              const requiresModifiers = hasRequiredModifiers(product);
              const cardActsAsAdd = product.currentStock !== 0;
              const showInlineSteppers =
                inCartQty > 0 && !requiresModifiers && !!onIncrement && !!onDecrement;

              return (
              <div
                key={product.id}
                role={cardActsAsAdd ? 'button' : undefined}
                tabIndex={cardActsAsAdd ? 0 : undefined}
                onClick={cardActsAsAdd ? () => onAddItem(product) : undefined}
                onKeyDown={
                  cardActsAsAdd
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onAddItem(product);
                        }
                      }
                    : undefined
                }
                aria-label={cardActsAsAdd ? `${t('addToOrder')}: ${product.name}` : undefined}
                className={`bg-white rounded-xl border overflow-hidden transition-all duration-200 flex ${
                  inCartQty > 0 ? 'border-primary-300 ring-1 ring-primary-200' : 'border-slate-200/60'
                } ${
                  cardActsAsAdd
                    ? 'cursor-pointer hover:shadow-md active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none'
                    : 'opacity-60 cursor-not-allowed'
                }`}
              >
                {/* Image */}
                <div className="w-32 h-28 flex-shrink-0 bg-slate-100 overflow-hidden relative">
                  {showImages && product.images && product.images.length > 0 ? (
                    <img
                      src={product.images[0].url.startsWith('http://') || product.images[0].url.startsWith('https://')
                        ? product.images[0].url
                        : `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${product.images[0].url}`}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="h-8 w-8 text-slate-300" />
                    </div>
                  )}

                  {/* Stock Badge */}
                  {product.currentStock !== null && product.currentStock <= 5 && (
                    <div className="absolute top-1.5 right-1.5">
                      <div className={`text-white text-xs font-bold px-1.5 py-0.5 rounded-full ${
                        product.currentStock === 0 ? 'bg-red-500' : 'bg-amber-500'
                      }`}>
                        {product.currentStock === 0 ? '0' : product.currentStock}
                      </div>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 truncate">{product.name}</h3>
                    {product.description && (
                      <p className="text-sm text-slate-500 line-clamp-1 mt-0.5">{product.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <p className="text-primary-600 font-bold text-lg">{formatPrice(product.price)}</p>
                      {product.currentStock !== null && product.currentStock <= 5 && product.currentStock > 0 && (
                        <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium ring-1 ring-inset ring-amber-200/60">
                          {t('lowStock')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Add / inline stepper */}
                  {showInlineSteppers ? (
                    <div
                      className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-0.5 flex-shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => onDecrement!(product.id)}
                        aria-label={t('menu.decrease', 'Azalt')}
                        className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-slate-100 transition-colors text-slate-600"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-7 text-center font-semibold text-sm text-slate-900 tabular-nums">
                        {inCartQty}
                      </span>
                      <button
                        type="button"
                        onClick={() => onIncrement!(product.id)}
                        aria-label={t('menu.increase', 'Artır')}
                        className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-slate-100 transition-colors text-slate-600"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <span
                      className={`px-4 py-2.5 min-h-[44px] rounded-lg font-medium transition-all duration-200 flex items-center gap-2 flex-shrink-0 ${
                        product.currentStock === 0
                          ? 'bg-slate-100 text-slate-400'
                          : 'bg-primary-500 text-white group-hover:bg-primary-600 shadow-sm'
                      }`}
                      aria-hidden="true"
                    >
                      <Plus className="h-5 w-5" />
                      <span className="hidden md:inline text-sm">
                        {product.currentStock === 0 ? t('outOfStock') : t('addToOrder')}
                      </span>
                    </span>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MenuPanel;
