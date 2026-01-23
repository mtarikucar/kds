import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { Product, Category } from '../../types';
import { cn } from '../../lib/utils';
import ProductDetailModalWithCart from '../../pages/qr-menu/ProductDetailModalWithCart';
import { useCartStore } from '../../store/cartStore';
import { MenuSettings } from '../../pages/qr-menu/QRMenuLayout';
import Skeleton from './ui/Skeleton';
import ProductCard from './ProductCard';
import CategoryBar from './CategoryBar';

interface QRMenuContentProps {
  categories: (Category & { products: Product[] })[];
  settings: MenuSettings;
  tenant: { id: string; name: string; currency?: string };
  enableCustomerOrdering: boolean;
  searchQuery?: string;
  isLoading?: boolean;
}

const QRMenuContent: React.FC<QRMenuContentProps> = ({
  categories,
  settings,
  tenant,
  enableCustomerOrdering,
  searchQuery: externalSearchQuery,
  isLoading = false,
}) => {
  const { t } = useTranslation('common');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [addedProductId, setAddedProductId] = useState<string | null>(null);
  const [localSearchQuery, setLocalSearchQuery] = useState(externalSearchQuery || '');
  const [activeSection, setActiveSection] = useState<string>('');

  const categoryRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  const addItem = useCartStore(state => state.addItem);

  // Update local search query when prop changes
  useEffect(() => {
    if (externalSearchQuery !== undefined) {
      setLocalSearchQuery(externalSearchQuery);
    }
  }, [externalSearchQuery]);

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

  // Group products by category
  const productsByCategory = categories.reduce((acc, cat) => {
    const categoryProducts = filteredProducts.filter(p => p.categoryId === cat.id);
    if (categoryProducts.length > 0) {
      acc.push({ category: cat, products: categoryProducts });
    }
    return acc;
  }, [] as { category: Category; products: Product[] }[]);

  // Scroll spy effect using IntersectionObserver for reliability
  useEffect(() => {
    // Don't run scroll spy when a specific category is selected
    if (selectedCategory) return;

    // Wait for next frame to ensure refs are populated
    const timeoutId = setTimeout(() => {
      const visibleSections = new Map<string, number>();
      const observers: IntersectionObserver[] = [];

      categoryRefs.current.forEach((element, categoryId) => {
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                visibleSections.set(categoryId, entry.intersectionRatio);
              } else {
                visibleSections.delete(categoryId);
              }

              // Find the most visible section
              let maxRatio = 0;
              let mostVisibleSection = '';
              visibleSections.forEach((ratio, id) => {
                if (ratio > maxRatio) {
                  maxRatio = ratio;
                  mostVisibleSection = id;
                }
              });

              // Only update if we have a visible section
              if (mostVisibleSection) {
                setActiveSection((prev) => {
                  // Only update if different to prevent unnecessary re-renders
                  return prev !== mostVisibleSection ? mostVisibleSection : prev;
                });
              }
            });
          },
          {
            root: null,
            rootMargin: '-15% 0px -70% 0px',
            threshold: [0, 0.1, 0.2, 0.3],
          }
        );

        observer.observe(element);
        observers.push(observer);
      });

      // Store cleanup function
      (window as any).__qrMenuObservers = observers;
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      const observers = (window as any).__qrMenuObservers;
      if (observers) {
        observers.forEach((observer: IntersectionObserver) => observer.disconnect());
        delete (window as any).__qrMenuObservers;
      }
    };
  }, [selectedCategory, productsByCategory.length]);

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

    // Clear activeSection when a specific category is selected
    if (categoryId) {
      setActiveSection('');
    }

    if (!categoryId) {
      // Scroll to top smoothly when "All" is clicked
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const element = categoryRefs.current.get(categoryId);
    if (element) {
      const offset = 150;
      const elementPosition = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: elementPosition - offset, behavior: 'smooth' });
    }
  };

  const handleQuickAdd = useCallback((product: Product, e: React.MouseEvent) => {
    e.stopPropagation();

    const hasRequiredModifiers = product.modifierGroups?.some(
      group => group.isRequired || group.minSelections > 0
    );

    if (hasRequiredModifiers) {
      setSelectedProduct(product);
      setIsModalOpen(true);
      return;
    }

    addItem(product, 1, []);
    setAddedProductId(product.id);
    setTimeout(() => setAddedProductId(null), 1500);
  }, [addItem]);

  const setCategoryRef = useCallback((categoryId: string) => (el: HTMLDivElement | null) => {
    if (el) {
      categoryRefs.current.set(categoryId, el);
    } else {
      categoryRefs.current.delete(categoryId);
    }
  }, []);

  const handleClearSearch = () => {
    setLocalSearchQuery('');
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <div>
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-lg border-b border-slate-100">
          <div className="px-4 sm:px-6 py-3">
            <div className="flex gap-2 overflow-hidden">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-24 rounded-full" animation="wave" />
              ))}
            </div>
          </div>
        </div>
        <div className="px-4 sm:px-6 py-6">
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                {settings.showImages && (
                  <div className="w-full aspect-[4/3] bg-slate-100">
                    <Skeleton className="w-full h-full" animation="wave" />
                  </div>
                )}
                <div className="p-3">
                  <Skeleton className="h-4 w-3/4 mb-2 rounded" animation="wave" />
                  <Skeleton className="h-3 w-full mb-1 rounded" animation="wave" />
                  <Skeleton className="h-3 w-2/3 rounded" animation="wave" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      {/* Search Bar */}
      <div className="px-4 sm:px-6 py-4 bg-white border-b border-slate-100">
        <div className="relative">
          <Search className="absolute left-4 rtl:left-auto rtl:right-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
          <input
            type="text"
            placeholder={t('qrMenu.searchPlaceholder', 'Search menu...')}
            value={localSearchQuery}
            onChange={(e) => setLocalSearchQuery(e.target.value)}
            className="w-full pl-12 pr-10 rtl:pl-10 rtl:pr-12 py-3 bg-slate-100 text-slate-900 placeholder-slate-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-opacity-50 transition-all"
            style={{ '--tw-ring-color': settings.primaryColor } as React.CSSProperties}
          />
          <AnimatePresence>
            {localSearchQuery && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={handleClearSearch}
                className="absolute right-3 rtl:right-auto rtl:left-3 top-1/2 transform -translate-y-1/2 p-1 rounded-full bg-slate-200 hover:bg-slate-300 transition-colors"
              >
                <X className="h-4 w-4 text-slate-500" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Category Bar */}
      <CategoryBar
        categories={categories}
        selectedCategory={selectedCategory}
        activeSection={activeSection}
        primaryColor={settings.primaryColor}
        onCategoryClick={handleCategoryClick}
      />

      {/* Products */}
      <div className="px-4 sm:px-6 py-6">
        {filteredProducts.length > 0 ? (
          selectedCategory ? (
            // Single category view
            <div className={cn(
              settings.layoutStyle === 'LIST'
                ? 'flex flex-col gap-4'
                : settings.itemsPerRow === 1
                  ? 'grid grid-cols-1 gap-4'
                  : settings.itemsPerRow === 3
                    ? 'grid grid-cols-2 sm:grid-cols-3 gap-4'
                    : 'grid grid-cols-2 gap-4'
            )}>
              {filteredProducts.map((product, index) => (
                <motion.div
                  key={product.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04, duration: 0.3 }}
                >
                  <ProductCard
                    product={product}
                    onClick={() => handleProductClick(product)}
                    onQuickAdd={(e) => handleQuickAdd(product, e)}
                    primaryColor={settings.primaryColor}
                    secondaryColor={settings.secondaryColor}
                    currency={tenant.currency || 'TRY'}
                    showImages={settings.showImages}
                    showDescription={settings.showDescription}
                    showPrices={settings.showPrices}
                    enableCustomerOrdering={enableCustomerOrdering}
                    layoutStyle={settings.layoutStyle}
                    isAdded={addedProductId === product.id}
                  />
                </motion.div>
              ))}
            </div>
          ) : (
            // All categories view
            <div className="space-y-8">
              {productsByCategory.map(({ category, products }) => (
                <motion.div
                  key={category.id}
                  ref={setCategoryRef(category.id)}
                  className="scroll-mt-36"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex items-center gap-3 mb-4">
                    <h2
                      className="text-lg font-bold"
                      style={{ color: settings.secondaryColor }}
                    >
                      {category.name}
                    </h2>
                    <div
                      className="flex-1 h-px"
                      style={{ backgroundColor: `${settings.primaryColor}20` }}
                    />
                    <span
                      className="text-xs font-medium px-2 py-1 rounded-full"
                      style={{
                        backgroundColor: `${settings.primaryColor}10`,
                        color: settings.primaryColor,
                      }}
                    >
                      {products.length}
                    </span>
                  </div>

                  <div className={cn(
                    settings.layoutStyle === 'LIST'
                      ? 'flex flex-col gap-4'
                      : settings.itemsPerRow === 1
                        ? 'grid grid-cols-1 gap-4'
                        : settings.itemsPerRow === 3
                          ? 'grid grid-cols-2 sm:grid-cols-3 gap-4'
                          : 'grid grid-cols-2 gap-4'
                  )}>
                    {products.map((product, index) => (
                      <motion.div
                        key={product.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.04, duration: 0.3 }}
                      >
                        <ProductCard
                          product={product}
                          onClick={() => handleProductClick(product)}
                          onQuickAdd={(e) => handleQuickAdd(product, e)}
                          primaryColor={settings.primaryColor}
                          secondaryColor={settings.secondaryColor}
                          currency={tenant.currency || 'TRY'}
                          showImages={settings.showImages}
                          showDescription={settings.showDescription}
                          showPrices={settings.showPrices}
                          enableCustomerOrdering={enableCustomerOrdering}
                          layoutStyle={settings.layoutStyle}
                          isAdded={addedProductId === product.id}
                        />
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
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
            <motion.div
              className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6"
              style={{ backgroundColor: `${settings.primaryColor}10` }}
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ repeat: Infinity, duration: 2 }}
            >
              <Search className="h-12 w-12" style={{ color: settings.primaryColor }} />
            </motion.div>
            <h3 className="text-xl font-bold text-slate-700 mb-2">
              {t('qrMenu.noProducts', 'No products found')}
            </h3>
            <p className="text-slate-500 text-sm mb-6 max-w-xs mx-auto">
              {t('qrMenu.noProductsDescription', 'Try adjusting your search or browse all categories')}
            </p>
            {(localSearchQuery || selectedCategory) && (
              <motion.button
                onClick={() => {
                  setLocalSearchQuery('');
                  setSelectedCategory('');
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold text-sm transition-all hover:scale-105"
                style={{
                  backgroundColor: settings.primaryColor,
                  color: 'white',
                }}
                whileTap={{ scale: 0.95 }}
              >
                <X className="h-4 w-4" />
                {t('qrMenu.clearFilters', 'Clear filters')}
              </motion.button>
            )}
          </motion.div>
        )}
      </div>

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
