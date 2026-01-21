import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories } from '../../features/menu/menuApi';
import { useProducts } from '../../features/menu/menuApi';
import { useGetPosSettings } from '../../features/pos/posApi';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { Product } from '../../types';
import { Card } from '../ui/Card';
import Spinner from '../ui/Spinner';
import { Plus, Grid3x3, List, Search, Package, AlertCircle, Sparkles } from 'lucide-react';

interface MenuPanelProps {
  onAddItem: (product: Product) => void;
}

type ViewMode = 'grid' | 'list';

const MenuPanel = ({ onAddItem }: MenuPanelProps) => {
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
      <div className="p-4 bg-white rounded-t-xl border-b border-slate-100 space-y-4">
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
      <div className="flex-1 overflow-y-auto p-4">
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
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                className="group bg-white rounded-xl border border-slate-200/60 overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
              >
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

                {/* Content */}
                <div className="p-4">
                  <h3 className="font-semibold text-slate-900 truncate">{product.name}</h3>
                  {product.description && (
                    <p className="text-sm text-slate-500 mt-1 line-clamp-1">{product.description}</p>
                  )}
                  <div className="flex items-center justify-between mt-3">
                    <p className="text-primary-600 font-bold text-lg">{formatPrice(product.price)}</p>
                    <button
                      onClick={() => onAddItem(product)}
                      disabled={product.currentStock === 0}
                      className={`p-2 rounded-lg transition-all duration-200 ${
                        product.currentStock === 0
                          ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          : 'bg-primary-500 text-white hover:bg-primary-600 shadow-sm hover:shadow active:scale-95'
                      }`}
                    >
                      <Plus className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="space-y-3">
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                className="bg-white rounded-xl border border-slate-200/60 overflow-hidden hover:shadow-md transition-all duration-200 flex"
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

                  {/* Add Button */}
                  <button
                    onClick={() => onAddItem(product)}
                    disabled={product.currentStock === 0}
                    className={`px-4 py-2.5 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 ${
                      product.currentStock === 0
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : 'bg-primary-500 text-white hover:bg-primary-600 shadow-sm hover:shadow active:scale-95'
                    }`}
                  >
                    <Plus className="h-5 w-5" />
                    <span className="hidden md:inline text-sm">
                      {product.currentStock === 0 ? t('outOfStock') : t('addToOrder')}
                    </span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MenuPanel;
