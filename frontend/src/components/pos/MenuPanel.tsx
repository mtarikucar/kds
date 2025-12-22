import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories } from '../../features/menu/menuApi';
import { useProducts } from '../../features/menu/menuApi';
import { useGetPosSettings } from '../../features/pos/posApi';
import { Product } from '../../types';
import { Card } from '../ui/Card';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import { formatCurrency } from '../../lib/utils';
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

  const showImages = posSettings?.showProductImages ?? true;

  // Filter products based on search query
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
    <div className="flex flex-col h-full bg-gradient-to-br from-gray-50 to-white rounded-xl">
      {/* Header Section */}
      <div className="p-4 bg-white rounded-t-xl border-b border-gray-200 space-y-4">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('menu.searchProducts')}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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
              className={`px-4 py-2 rounded-full font-medium text-sm whitespace-nowrap flex-shrink-0 transition-all transform hover:scale-105 ${
                !selectedCategoryId
                  ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md'
                  : 'bg-white border-2 border-gray-300 text-gray-700 hover:border-blue-400'
              }`}
            >
              <span className="flex items-center gap-1">
                <Sparkles className="h-4 w-4" />
                {t('common:all')}
              </span>
            </button>
            {categories?.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategoryId(category.id)}
                className={`px-4 py-2 rounded-full font-medium text-sm whitespace-nowrap flex-shrink-0 transition-all transform hover:scale-105 ${
                  selectedCategoryId === category.id
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md'
                    : 'bg-white border-2 border-gray-300 text-gray-700 hover:border-blue-400'
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>

          {/* View Mode Toggle */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 flex-shrink-0">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-md transition-all ${
                viewMode === 'grid'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-white'
              }`}
              aria-label={t('menu.gridView')}
              title={t('menu.gridView')}
            >
              <Grid3x3 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-md transition-all ${
                viewMode === 'list'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-white'
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
            <Package className="h-16 w-16 text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              {searchQuery ? t('menu.noProductsFound') : t('menu.noProducts')}
            </h3>
            <p className="text-gray-500 text-sm">
              {searchQuery ? t('menu.tryDifferentSearch') : t('menu.selectDifferentCategory')}
            </p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {t('menu.clearSearch')}
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View - Compact Overlay Design */
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
            {filteredProducts.map((product, index) => (
              <div
                key={product.id}
                className="group animate-in fade-in slide-in-from-bottom-4 duration-300"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <Card className="relative h-56 overflow-hidden hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 cursor-pointer">
                  {/* Background Image */}
                  <div className="absolute inset-0">
                    {showImages && product.images && product.images.length > 0 ? (
                      <>
                        <img
                          src={product.images[0].url.startsWith('http://') || product.images[0].url.startsWith('https://')
                            ? product.images[0].url
                            : `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${product.images[0].url}`}
                          alt={product.name}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                        />
                        {/* Dark gradient overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-600 to-blue-700">
                        <Package className="h-16 w-16 text-white/30" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      </div>
                    )}
                  </div>

                  {/* Stock Badge - Top Right */}
                  {product.currentStock !== null && product.currentStock <= 5 && (
                    <div className="absolute top-2 right-2 z-10">
                      <div className={`text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 shadow-lg backdrop-blur-sm ${
                        product.currentStock === 0 ? 'bg-red-500/90' : 'bg-orange-500/90'
                      }`}>
                        <AlertCircle className="h-3 w-3" />
                        {product.currentStock === 0 ? t('outOfStock') : product.currentStock}
                      </div>
                    </div>
                  )}

                  {/* Content Overlay */}
                  <div className="absolute inset-0 p-4 flex flex-col justify-between">
                    {/* Top: Product Name */}
                    <div>
                      <h3 className="font-bold text-white text-base leading-tight line-clamp-2 drop-shadow-lg">
                        {product.name}
                      </h3>
                      {product.description && (
                        <p className="text-white/90 text-xs mt-1.5 line-clamp-1 drop-shadow-md">
                          {product.description}
                        </p>
                      )}
                    </div>

                    {/* Bottom: Price & Add Button */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-white font-black text-2xl drop-shadow-lg">
                          {formatCurrency(product.price)}
                        </p>
                      </div>

                      {/* Add Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddItem(product);
                        }}
                        disabled={product.currentStock === 0}
                        className={`w-full font-bold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2 backdrop-blur-sm ${
                          product.currentStock === 0
                            ? 'bg-gray-500/50 text-white/50 cursor-not-allowed'
                            : 'bg-white/95 hover:bg-white text-blue-600 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95'
                        }`}
                      >
                        <Plus className="h-5 w-5" />
                        <span className="text-sm">{product.currentStock === 0 ? t('outOfStock') : t('addToOrder')}</span>
                      </button>
                    </div>
                  </div>
                </Card>
              </div>
            ))}
          </div>
        ) : (
          /* List View - Compact Horizontal Cards */
          <div className="space-y-2">
            {filteredProducts.map((product, index) => (
              <div
                key={product.id}
                className="animate-in fade-in slide-in-from-left duration-300"
                style={{ animationDelay: `${index * 20}ms` }}
              >
                <Card className="relative h-28 overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer border-2 border-transparent hover:border-blue-200">
                  {/* Background Image with Gradient */}
                  <div className="absolute inset-0 flex">
                    {/* Left: Image Section */}
                    <div className="w-36 flex-shrink-0 relative overflow-hidden">
                      {showImages && product.images && product.images.length > 0 ? (
                        <>
                          <img
                            src={product.images[0].url.startsWith('http://') || product.images[0].url.startsWith('https://')
                              ? product.images[0].url
                              : `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'}${product.images[0].url}`}
                            alt={product.name}
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                          />
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/40" />
                        </>
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center">
                          <Package className="h-10 w-10 text-white/30" />
                        </div>
                      )}

                      {/* Stock Badge */}
                      {product.currentStock !== null && product.currentStock <= 5 && (
                        <div className="absolute top-1 right-1">
                          <div className={`text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-lg ${
                            product.currentStock === 0 ? 'bg-red-500' : 'bg-orange-500'
                          }`}>
                            {product.currentStock === 0 ? '0' : product.currentStock}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right: Content Section with White Background */}
                    <div className="flex-1 bg-white flex items-center justify-between px-5 gap-4">
                      {/* Product Info */}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-lg text-gray-800 line-clamp-1 mb-1">
                          {product.name}
                        </h3>
                        {product.description && (
                          <p className="text-sm text-gray-500 line-clamp-1 mb-1.5">
                            {product.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2">
                          <p className="text-2xl font-black bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
                            {formatCurrency(product.price)}
                          </p>
                          {product.currentStock !== null && product.currentStock <= 5 && product.currentStock > 0 && (
                            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              {t('lowStock')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Add Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddItem(product);
                        }}
                        disabled={product.currentStock === 0}
                        className={`font-bold px-5 py-3 rounded-lg transition-all flex items-center justify-center gap-2 flex-shrink-0 min-w-[110px] ${
                          product.currentStock === 0
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-md hover:shadow-lg transform hover:scale-105 active:scale-95'
                        }`}
                        aria-label={t('addToOrder')}
                      >
                        <Plus className="h-5 w-5" />
                        <span className="text-sm hidden md:inline">
                          {product.currentStock === 0 ? t('outOfStock') : t('addToOrder')}
                        </span>
                      </button>
                    </div>
                  </div>
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MenuPanel;
