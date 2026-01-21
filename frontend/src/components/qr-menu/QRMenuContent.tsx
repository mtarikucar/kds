import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, Check, Search, X } from 'lucide-react';
import { Product, Category } from '../../types';
import { Card, CardContent } from '../../components/ui/Card';
import { formatCurrency, cn } from '../../lib/utils';
import ProductDetailModalWithCart from '../../pages/qr-menu/ProductDetailModalWithCart';
import { useCartStore } from '../../store/cartStore';
import { MenuSettings } from '../../pages/qr-menu/QRMenuLayout';
import ProgressiveImage from './ui/ProgressiveImage';
import ProductCardSkeleton from './ProductCardSkeleton';

interface QRMenuContentProps {
  categories: (Category & { products: Product[] })[];
  settings: MenuSettings;
  tenant: { id: string; name: string; currency?: string };
  enableCustomerOrdering: boolean;
  searchQuery: string;
  isLoading?: boolean;
}

const QRMenuContent: React.FC<QRMenuContentProps> = ({
  categories,
  settings,
  tenant,
  enableCustomerOrdering,
  searchQuery,
  isLoading = false,
}) => {
  const { t } = useTranslation('common');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [addedProductId, setAddedProductId] = useState<string | null>(null);
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);
  const [activeSection, setActiveSection] = useState<string>('');
  const [flyingProduct, setFlyingProduct] = useState<{ id: string; x: number; y: number } | null>(null);

  const categoryRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const categoryBarRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Group products by category for scroll-spy
  const productsByCategory = categories.reduce((acc, cat) => {
    const categoryProducts = filteredProducts.filter(p => p.categoryId === cat.id);
    if (categoryProducts.length > 0) {
      acc.push({ category: cat, products: categoryProducts });
    }
    return acc;
  }, [] as { category: Category; products: Product[] }[]);

  // Scroll spy effect
  useEffect(() => {
    if (selectedCategory) return; // Skip scroll-spy when filtering

    const handleScroll = () => {
      const container = containerRef.current;
      if (!container) return;

      const scrollTop = window.scrollY;
      const offset = 150; // Account for sticky header

      let currentSection = '';
      categoryRefs.current.forEach((element, categoryId) => {
        const rect = element.getBoundingClientRect();
        if (rect.top <= offset && rect.bottom > offset) {
          currentSection = categoryId;
        }
      });

      if (currentSection && currentSection !== activeSection) {
        setActiveSection(currentSection);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [selectedCategory, activeSection]);

  // Scroll category button into view
  useEffect(() => {
    if (!categoryBarRef.current || !activeSection) return;

    const activeButton = categoryBarRef.current.querySelector(`[data-category-id="${activeSection}"]`);
    if (activeButton) {
      activeButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeSection]);

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

  const handleCategoryClick = (categoryId: string) => {
    setSelectedCategory(categoryId);

    if (!categoryId) {
      // Show all - scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Scroll to category section
    const element = categoryRefs.current.get(categoryId);
    if (element) {
      const offset = 120;
      const elementPosition = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: elementPosition - offset, behavior: 'smooth' });
    }
  };

  const handleAddToCart = useCallback((product: Product, e: React.MouseEvent) => {
    // Check for required modifiers
    const hasRequiredModifiers = product.modifierGroups?.some(
      group => group.isRequired || group.minSelections > 0
    );

    if (hasRequiredModifiers) {
      setSelectedProduct(product);
      setIsModalOpen(true);
      return;
    }

    // Fly-to-cart animation
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setFlyingProduct({
      id: product.id,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });

    // Add to cart
    addItem(product, 1, []);
    setAddedProductId(product.id);

    // Clear animations
    setTimeout(() => {
      setFlyingProduct(null);
      setTimeout(() => setAddedProductId(null), 1500);
    }, 500);
  }, [addItem]);

  const setCategoryRef = useCallback((categoryId: string) => (el: HTMLDivElement | null) => {
    if (el) {
      categoryRefs.current.set(categoryId, el);
    } else {
      categoryRefs.current.delete(categoryId);
    }
  }, []);

  // Show skeleton while loading
  if (isLoading) {
    return (
      <div className="mb-20 md:mb-0">
        {/* Skeleton Category Bar */}
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-lg border-b border-slate-100">
          <div className="px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex gap-2 overflow-hidden">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-9 w-20 bg-slate-200 rounded-full animate-pulse" />
              ))}
            </div>
          </div>
        </div>

        {/* Skeleton Products */}
        <div className="px-4 sm:px-6 lg:px-8 py-6">
          <ProductCardSkeleton
            count={6}
            layoutStyle={settings.layoutStyle}
            showImages={settings.showImages}
            itemsPerRow={settings.itemsPerRow}
          />
        </div>
      </div>
    );
  }

  const renderProductCard = (product: Product, index: number) => {
    const imageUrl = normalizeImageUrl(product.image || product.images?.[0]?.url);

    return (
      <motion.div
        key={product.id}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.03, duration: 0.3 }}
      >
        <Card
          className={cn(
            'overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer group',
            settings.layoutStyle === 'LIST' ? 'flex flex-row' : 'flex flex-col'
          )}
          onClick={() => handleProductClick(product)}
        >
          {/* Product Image */}
          {settings.showImages && imageUrl && (
            <div className={cn(
              'relative overflow-hidden bg-slate-200 flex-shrink-0',
              settings.layoutStyle === 'LIST' ? 'w-24 h-24 sm:w-32 sm:h-32' : 'h-32 sm:h-40 w-full'
            )}>
              <ProgressiveImage
                src={imageUrl}
                alt={product.name}
                className="group-hover:scale-110 transition-transform duration-500"
              />
              {product.isAvailable === false && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <span className="text-white font-bold text-xs sm:text-sm text-center px-2">
                    {t('qrMenu.unavailable')}
                  </span>
                </div>
              )}
            </div>
          )}

          <CardContent className={cn(
            'p-3 sm:p-4 flex-1',
            settings.layoutStyle === 'LIST' ? 'flex flex-col justify-center' : ''
          )}>
            <h3
              className="font-bold text-sm sm:text-base mb-1 line-clamp-2"
              style={{ color: settings.secondaryColor }}
            >
              {product.name}
            </h3>

            {settings.showDescription && product.description && (
              <p className="text-xs sm:text-sm text-slate-600 mb-2 line-clamp-2">
                {product.description}
              </p>
            )}

            <div className="flex items-center justify-between mt-auto">
              {settings.showPrices && (
                <span className="font-bold text-sm sm:text-base" style={{ color: settings.primaryColor }}>
                  {formatCurrency(product.price, tenant.currency || 'TRY')}
                </span>
              )}

              {enableCustomerOrdering && (
                <motion.button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddToCart(product, e);
                  }}
                  disabled={product.isAvailable === false}
                  className="p-2.5 rounded-xl transition-all duration-200 relative overflow-hidden"
                  style={{
                    backgroundColor: addedProductId === product.id ? '#10b981' : settings.primaryColor,
                    opacity: product.isAvailable === false ? 0.5 : 1,
                  }}
                  whileTap={{ scale: 0.9 }}
                  whileHover={{ scale: 1.1 }}
                >
                  <AnimatePresence mode="wait">
                    {addedProductId === product.id ? (
                      <motion.div
                        key="check"
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        exit={{ scale: 0, rotate: 180 }}
                        transition={{ duration: 0.2 }}
                      >
                        <Check className="h-4 w-4 text-white" />
                      </motion.div>
                    ) : (
                      <motion.div
                        key="cart"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        exit={{ scale: 0 }}
                      >
                        <ShoppingCart className="h-4 w-4 text-white" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  return (
    <div ref={containerRef} className="mb-20 md:mb-0">
      {/* Sticky Category Bar */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-lg border-b border-slate-100 shadow-sm">
        <div
          ref={categoryBarRef}
          className="flex gap-2 overflow-x-auto pb-3 pt-3 px-4 sm:px-6 lg:px-8 scrollbar-hide"
        >
          <button
            data-category-id=""
            onClick={() => handleCategoryClick('')}
            className={cn(
              'flex-shrink-0 px-4 py-2 rounded-full font-semibold transition-all duration-200 whitespace-nowrap',
              !selectedCategory && !activeSection
                ? 'text-white shadow-lg scale-105'
                : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200'
            )}
            style={{
              backgroundColor: !selectedCategory && !activeSection ? settings.primaryColor : undefined,
            }}
          >
            {t('qrMenu.allCategories', 'All')}
          </button>

          {categories.map((category) => {
            const isActive = selectedCategory === category.id || activeSection === category.id;
            return (
              <button
                key={category.id}
                data-category-id={category.id}
                onClick={() => handleCategoryClick(category.id)}
                className={cn(
                  'flex-shrink-0 px-4 py-2 rounded-full font-semibold transition-all duration-200 whitespace-nowrap',
                  isActive
                    ? 'text-white shadow-lg scale-105'
                    : 'bg-white text-slate-700 hover:bg-slate-50 border border-slate-200'
                )}
                style={{
                  backgroundColor: isActive ? settings.primaryColor : undefined,
                }}
              >
                {category.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Products */}
      <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
        {filteredProducts.length > 0 ? (
          selectedCategory ? (
            // Single category view (filtered)
            <div className={cn(
              settings.layoutStyle === 'LIST'
                ? 'flex flex-col gap-3'
                : settings.itemsPerRow === 1
                  ? 'grid grid-cols-1 gap-3 sm:gap-4'
                  : settings.itemsPerRow === 3
                    ? 'grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4'
                    : 'grid grid-cols-2 gap-3 sm:gap-4'
            )}>
              {filteredProducts.map((product, index) => renderProductCard(product, index))}
            </div>
          ) : (
            // All categories view with sections
            <div className="space-y-8">
              {productsByCategory.map(({ category, products }) => (
                <div
                  key={category.id}
                  ref={setCategoryRef(category.id)}
                  className="scroll-mt-32"
                >
                  <h2
                    className="text-xl font-bold mb-4 pb-2 border-b"
                    style={{ color: settings.secondaryColor, borderColor: `${settings.primaryColor}30` }}
                  >
                    {category.name}
                  </h2>
                  <div className={cn(
                    settings.layoutStyle === 'LIST'
                      ? 'flex flex-col gap-3'
                      : settings.itemsPerRow === 1
                        ? 'grid grid-cols-1 gap-3 sm:gap-4'
                        : settings.itemsPerRow === 3
                          ? 'grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4'
                          : 'grid grid-cols-2 gap-3 sm:gap-4'
                  )}>
                    {products.map((product, index) => renderProductCard(product, index))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          // Empty state
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-16"
          >
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: `${settings.primaryColor}15` }}
            >
              <Search className="h-10 w-10" style={{ color: settings.primaryColor }} />
            </div>
            <h3 className="text-lg font-semibold text-slate-700 mb-2">
              {t('qrMenu.noProducts', 'No products found')}
            </h3>
            <p className="text-slate-500 text-sm mb-4">
              {t('qrMenu.noProductsDescription', 'Try adjusting your search or browse all categories')}
            </p>
            {(localSearchQuery || selectedCategory) && (
              <button
                onClick={() => {
                  setLocalSearchQuery('');
                  setSelectedCategory('');
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors"
                style={{ backgroundColor: `${settings.primaryColor}15`, color: settings.primaryColor }}
              >
                <X className="h-4 w-4" />
                {t('qrMenu.clearFilters', 'Clear filters')}
              </button>
            )}
          </motion.div>
        )}
      </div>

      {/* Flying Product Animation */}
      <AnimatePresence>
        {flyingProduct && (
          <motion.div
            key="flying-product"
            initial={{
              position: 'fixed',
              left: flyingProduct.x,
              top: flyingProduct.y,
              scale: 1,
              opacity: 1,
              zIndex: 100,
            }}
            animate={{
              left: window.innerWidth - 60,
              top: window.innerHeight - 60,
              scale: 0.2,
              opacity: 0,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
            className="pointer-events-none"
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ backgroundColor: settings.primaryColor }}
            >
              <ShoppingCart className="h-6 w-6 text-white" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
