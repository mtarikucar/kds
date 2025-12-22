import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ShoppingCart, Check } from 'lucide-react';
import { Product, Category } from '../../types';
import { Card, CardContent } from '../../components/ui/Card';
import { formatCurrency } from '../../lib/utils';
import ProductDetailModalWithCart from '../../pages/qr-menu/ProductDetailModalWithCart';
import { useCartStore } from '../../store/cartStore';
import { MenuSettings } from '../../pages/qr-menu/QRMenuLayout';

interface QRMenuContentProps {
  categories: (Category & { products: Product[] })[];
  settings: MenuSettings;
  tenant: { id: string; name: string; currency?: string };
  enableCustomerOrdering: boolean;
  searchQuery: string;
}

const QRMenuContent: React.FC<QRMenuContentProps> = ({
  categories,
  settings,
  tenant,
  enableCustomerOrdering,
  searchQuery,
}) => {
  const { t } = useTranslation('common');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [addedProductId, setAddedProductId] = useState<string | null>(null);
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);

  const addItem = useCartStore(state => state.addItem);

  // Update local search query when prop changes
  useEffect(() => {
    setLocalSearchQuery(searchQuery);
  }, [searchQuery]);

  // Get all products
  const allProducts = categories.flatMap(cat => cat.products);

  // Filter products
  const filteredProducts = allProducts.filter((product) => {
    const matchesCategory = !selectedCategory || product.categoryId === selectedCategory;
    const matchesSearch =
      !localSearchQuery ||
      product.name.toLowerCase().includes(localSearchQuery.toLowerCase()) ||
      product.description?.toLowerCase().includes(localSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const normalizeImageUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;
    const normalizedPath = url.replace(/\\/g, '/');
    if (normalizedPath.startsWith('http://') || normalizedPath.startsWith('https://')) {
      return normalizedPath;
    }
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
    const BASE_URL = API_URL.replace(/\/api$/, '');
    const path = normalizedPath.startsWith('/') ? normalizedPath.substring(1) : normalizedPath;
    return `${BASE_URL}/${path}`;
  };

  const handleProductClick = (product: Product) => {
    setSelectedProduct(product);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedProduct(null);
  };

  const handleAddToCart = (product: Product) => {
    addItem(product, 1, []);
    setAddedProductId(product.id);
    setTimeout(() => setAddedProductId(null), 2000);
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 mb-20 md:mb-0">
      {/* Categories - Horizontal Scroll */}
      <div className="mb-6 sm:mb-8 flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 sm:mx-0 sm:px-0">
        <button
          onClick={() => setSelectedCategory('')}
          className={`flex-shrink-0 px-4 py-2 rounded-full font-semibold transition-all duration-200 whitespace-nowrap ${
            !selectedCategory
              ? 'text-white shadow-lg'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
          style={{
            backgroundColor: !selectedCategory ? settings.primaryColor : undefined,
          }}
        >
          {t('qrMenu.allCategories', 'All')}
        </button>

        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => setSelectedCategory(category.id)}
            className={`flex-shrink-0 px-4 py-2 rounded-full font-semibold transition-all duration-200 whitespace-nowrap ${
              selectedCategory === category.id
                ? 'text-white shadow-lg'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            style={{
              backgroundColor: selectedCategory === category.id ? settings.primaryColor : undefined,
            }}
          >
            {category.name}
          </button>
        ))}
      </div>

      {/* Products - Grid or List based on layoutStyle */}
      {filteredProducts.length > 0 ? (
        <div className={
          settings.layoutStyle === 'LIST'
            ? 'flex flex-col gap-3'
            : settings.itemsPerRow === 1
              ? 'grid grid-cols-1 gap-3 sm:gap-4'
              : settings.itemsPerRow === 3
                ? 'grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4'
                : 'grid grid-cols-2 gap-3 sm:gap-4'
        }>
          {filteredProducts.map((product, index) => (
            <Card
              key={product.id}
              className={`overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer animate-in fade-in slide-in-from-bottom ${
                settings.layoutStyle === 'LIST' ? 'flex flex-row' : 'flex flex-col'
              }`}
              style={{ animationDelay: `${index * 30}ms` }}
              onClick={() => handleProductClick(product)}
            >
              {/* Product Image - Show if setting enabled and image available */}
              {settings.showImages && (product.image || product.images?.[0]?.url) && (
                <div className={`relative overflow-hidden bg-gray-200 flex-shrink-0 ${
                  settings.layoutStyle === 'LIST' ? 'w-24 h-24 sm:w-32 sm:h-32' : 'h-32 sm:h-40 w-full'
                }`}>
                  <img
                    src={normalizeImageUrl(product.image || product.images?.[0]?.url)}
                    alt={product.name}
                    className="w-full h-full object-cover hover:scale-110 transition-transform duration-300"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  {product.isAvailable === false && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <span className="text-white font-bold text-xs sm:text-sm text-center px-2">{t('qrMenu.unavailable')}</span>
                    </div>
                  )}
                </div>
              )}

              <CardContent className={`p-3 sm:p-4 flex-1 ${settings.layoutStyle === 'LIST' ? 'flex flex-col justify-center' : ''}`}>
                <h3 className="font-bold text-sm sm:text-base mb-1 line-clamp-2" style={{ color: settings.secondaryColor }}>
                  {product.name}
                </h3>

                {settings.showDescription && product.description && (
                  <p className="text-xs sm:text-sm text-gray-600 mb-2 line-clamp-2">
                    {product.description}
                  </p>
                )}

                <div className="flex items-center justify-between">
                  {settings.showPrices && (
                    <span className="font-bold text-sm sm:text-base" style={{ color: settings.primaryColor }}>
                      {formatCurrency(product.price, tenant.currency || 'TRY')}
                    </span>
                  )}

                  {/* Only show add to cart button if customer ordering is enabled */}
                  {enableCustomerOrdering && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToCart(product);
                      }}
                      disabled={product.isAvailable === false}
                      className="p-2 rounded-lg transition-all duration-200 transform hover:scale-110 active:scale-95"
                      style={{
                        backgroundColor: addedProductId === product.id ? settings.secondaryColor : settings.primaryColor,
                        opacity: product.isAvailable === false ? 0.5 : 1,
                      }}
                    >
                      {addedProductId === product.id ? (
                        <Check className="h-4 w-4 text-white" />
                      ) : (
                        <ShoppingCart className="h-4 w-4 text-white" />
                      )}
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">{t('qrMenu.noProducts', 'No products found')}</p>
        </div>
      )}

      {/* Product Detail Modal */}
      {selectedProduct && (
        <ProductDetailModalWithCart
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          product={selectedProduct}
          primaryColor={settings.primaryColor}
          secondaryColor={settings.secondaryColor}
          showImages={settings.showImages}
          showDescription={settings.showDescription}
          showPrices={settings.showPrices}
          enableCustomerOrdering={enableCustomerOrdering}
          currency={tenant.currency || 'TRY'}
        />
      )}
    </div>
  );
};

export default QRMenuContent;

