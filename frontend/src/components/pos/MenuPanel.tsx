import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories } from '../../features/menu/menuApi';
import { useProducts } from '../../features/menu/menuApi';
import { Product } from '../../types';
import { Card } from '../ui/Card';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import { formatCurrency } from '../../lib/utils';
import { Plus, Grid3x3, List } from 'lucide-react';

interface MenuPanelProps {
  onAddItem: (product: Product) => void;
}

type ViewMode = 'grid' | 'list';

const MenuPanel = ({ onAddItem }: MenuPanelProps) => {
  const { t } = useTranslation('pos');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const { data: products, isLoading: productsLoading } = useProducts({
    categoryId: selectedCategoryId || undefined,
    isAvailable: true,
  });

  if (categoriesLoading) {
    return <Spinner />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with Category Scroll and View Toggle */}
      <div className="flex items-center gap-3 mb-4">
        {/* Category Chips - Horizontal Scroll */}
        <div className="flex gap-2 overflow-x-auto pb-2 flex-1 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
          <Button
            variant={!selectedCategoryId ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setSelectedCategoryId('')}
            className="whitespace-nowrap flex-shrink-0"
          >
            {t('common:all')}
          </Button>
          {categories?.map((category) => (
            <Button
              key={category.id}
              variant={selectedCategoryId === category.id ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategoryId(category.id)}
              className="whitespace-nowrap flex-shrink-0"
            >
              {category.name}
            </Button>
          ))}
        </div>

        {/* View Mode Toggle */}
        <div className="flex gap-1 border border-gray-300 rounded-lg p-1 flex-shrink-0">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded transition-colors ${
              viewMode === 'grid'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            aria-label={t('menu.gridView')}
            title={t('menu.gridView')}
          >
            <Grid3x3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded transition-colors ${
              viewMode === 'list'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            aria-label={t('menu.listView')}
            title={t('menu.listView')}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Products Grid/List */}
      <div className="flex-1 overflow-y-auto">
        {productsLoading ? (
          <Spinner />
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
            {products?.map((product) => (
              <Card
                key={product.id}
                className="p-3 md:p-4 hover:shadow-md transition-all"
              >
                {product.imageUrl && (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-32 object-cover rounded-md mb-2"
                  />
                )}
                <div className="text-center mb-3">
                  <h3 className="font-semibold text-sm md:text-base mb-1 line-clamp-2">
                    {product.name}
                  </h3>
                  <p className="text-blue-600 font-bold text-lg">
                    {formatCurrency(product.price)}
                  </p>
                  {product.stock <= 5 && (
                    <p className="text-xs text-red-600 mt-1">
                      {t('lowStock')}: {product.stock}
                    </p>
                  )}
                </div>
                {/* Quick Add Button - Large Touch Target */}
                <button
                  onClick={() => onAddItem(product)}
                  className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 min-h-[48px]"
                >
                  <Plus className="h-5 w-5" />
                  <span className="text-sm">{t('addToOrder')}</span>
                </button>
              </Card>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="space-y-2">
            {products?.map((product) => (
              <Card
                key={product.id}
                className="p-3 hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3">
                  {/* Image - Optional */}
                  {product.imageUrl && (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="w-16 h-16 md:w-20 md:h-20 object-cover rounded-md flex-shrink-0"
                    />
                  )}

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm md:text-base truncate">
                      {product.name}
                    </h3>
                    <p className="text-blue-600 font-bold text-base md:text-lg">
                      {formatCurrency(product.price)}
                    </p>
                    {product.stock <= 5 && (
                      <p className="text-xs text-red-600">
                        {t('lowStock')}: {product.stock}
                      </p>
                    )}
                  </div>

                  {/* Quick Add Button */}
                  <button
                    onClick={() => onAddItem(product)}
                    className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold p-3 md:p-4 rounded-lg transition-colors flex items-center justify-center flex-shrink-0 min-w-[48px] min-h-[48px]"
                    aria-label={t('addToOrder')}
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MenuPanel;
