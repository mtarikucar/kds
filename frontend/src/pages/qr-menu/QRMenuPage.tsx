import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Category, Product } from '../../types';
import { Card, CardContent } from '../../components/ui/Card';
import Spinner from '../../components/ui/Spinner';
import { formatCurrency } from '../../lib/utils';
import { UtensilsCrossed, Search, ChevronRight, ShoppingCart } from 'lucide-react';
import ProductDetailModalWithCart from './ProductDetailModalWithCart';
import { useCartStore } from '../../store/cartStore';

interface MenuSettings {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  fontFamily: string;
  logoUrl?: string;
  showRestaurantInfo: boolean;
  showPrices: boolean;
  showDescription: boolean;
  showImages: boolean;
  layoutStyle: 'GRID' | 'LIST' | 'COMPACT';
  itemsPerRow: number;
}

interface MenuData {
  tenant: {
    id: string;
    name: string;
  };
  table?: {
    id: string;
    number: string;
  };
  settings: MenuSettings;
  enableCustomerOrdering: boolean;
  categories: (Category & { products: Product[] })[];
}

const QRMenuPage = () => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get('tableId');

  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Cart state
  const initializeSession = useCartStore(state => state.initializeSession);
  const getItemCount = useCartStore(state => state.getItemCount);

  useEffect(() => {
    const fetchMenuData = async () => {
      try {
        setIsLoading(true);
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

        const url = tableId
          ? `${API_URL}/qr-menu/${tenantId}?tableId=${tableId}`
          : `${API_URL}/qr-menu/${tenantId}`;

        const response = await axios.get(url);
        setMenuData(response.data);
        setIsLoading(false);
      } catch (err: any) {
  console.error('Error fetching menu data:', err);
  setError(err.response?.data?.message || t('messages.operationFailed'));
        setIsLoading(false);
      }
    };

    if (tenantId) {
      fetchMenuData();
    }
  }, [tenantId, tableId]);

  // Initialize cart session when menu data is loaded
  useEffect(() => {
    if (menuData && tenantId && tableId) {
      initializeSession(tenantId, tableId);
    }
  }, [menuData, tenantId, tableId, initializeSession]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <p className="text-gray-600">{t('messages.contactSupport')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!menuData) return null;

  const { tenant, table, settings, enableCustomerOrdering, categories } = menuData;

  // Get all products from all categories
  const allProducts = categories.flatMap(cat => cat.products);

  // Filter products based on category and search query
  const filteredProducts = allProducts.filter((product) => {
    const matchesCategory = !selectedCategory || product.categoryId === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Normalize image URL - convert to absolute URL
  const normalizeImageUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;

    // Replace backslashes with forward slashes for Windows paths
    const normalizedPath = url.replace(/\\/g, '/');

    // If URL is already absolute, return as is
    if (normalizedPath.startsWith('http://') || normalizedPath.startsWith('https://')) {
      return normalizedPath;
    }

    // Get API URL from environment or use default
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
    // Extract base URL (remove /api suffix if present)
    const BASE_URL = API_URL.replace(/\/api$/, '');

    // Remove leading slash if present to avoid double slashes
    const path = normalizedPath.startsWith('/') ? normalizedPath.substring(1) : normalizedPath;

    // Construct full URL
    return `${BASE_URL}/${path}`;
  };

  const handleProductClick = (product: Product) => {
    // Only allow product clicks if customer ordering is enabled
    if (!enableCustomerOrdering) return;

    setSelectedProduct(product);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedProduct(null);
  };

  return (
    <div
      className="flex flex-col min-h-screen"
      style={{
        backgroundColor: settings.backgroundColor,
        fontFamily: settings.fontFamily,
      }}
    >
      {/* Header - Modern gradient design */}
      <div
        className="sticky top-0 z-20 shadow-2xl"
        style={{
          background: `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`,
        }}
      >
        {/* Decorative elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -mr-20 -mt-20"></div>
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full -ml-16 -mb-16"></div>
        </div>

        <div className="relative px-4 sm:px-6 py-5 sm:py-7">
          {settings.showRestaurantInfo && (
            <div className="flex items-center gap-4 mb-5">
              {/* Logo/Icon with modern styling */}
              <div className="relative">
                {settings.logoUrl ? (
                  <img
                    src={settings.logoUrl}
                    alt={tenant.name}
                    className="h-16 w-16 rounded-2xl object-cover shadow-xl ring-2 ring-white/30"
                  />
                ) : (
                  <div
                    className="h-16 w-16 rounded-2xl flex items-center justify-center shadow-xl ring-2 ring-white/30 bg-white/10"
                    style={{ backgroundColor: settings.secondaryColor }}
                  >
                    <UtensilsCrossed className="h-8 w-8 text-white" />
                  </div>
                )}
                {/* Pulse animation indicator */}
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-400 rounded-full shadow-lg ring-2 ring-white animate-pulse"></div>
              </div>

              {/* Restaurant info */}
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl sm:text-3xl font-black text-white truncate drop-shadow-lg">
                  {tenant.name}
                </h1>
                {table && (
                  <p className="text-sm sm:text-base text-white/90 font-semibold drop-shadow">
                    {t('qrMenu.tableLabel')} <span className="font-black">#{table.number}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Search - Modern design */}
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-white/60 group-focus-within:text-white transition-colors" />
            <input
              type="text"
              placeholder={t('qrMenu.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-5 py-3.5 border-0 bg-white/20 backdrop-blur-sm text-white placeholder-white/60 rounded-2xl focus:outline-none focus:ring-2 focus:ring-white/50 focus:bg-white/30 transition-all duration-200 shadow-lg hover:bg-white/25"
            />
          </div>
        </div>
      </div>

      {/* Warning Banner for Disabled Ordering */}
      {!enableCustomerOrdering && (
        <div className="mx-4 sm:mx-6 mt-4 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg shadow-md">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-yellow-800">
                {t('qrMenu.orderingDisabledShort')}
              </p>
              <p className="text-xs text-yellow-700 mt-1">
                {t('qrMenu.viewOnlyMode')}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 px-4 sm:px-6 py-6">
        {/* Categories - Horizontal Scroll */}
        <div className="mb-8 flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 sm:mx-0 sm:px-0">
          <button
            onClick={() => setSelectedCategory('')}
            className={`px-4 py-2.5 rounded-full whitespace-nowrap font-medium transition-all duration-200 transform hover:scale-105 flex-shrink-0 ${
              !selectedCategory ? 'shadow-lg' : 'shadow'
            }`}
            style={{
              backgroundColor: !selectedCategory ? settings.primaryColor : 'white',
              color: !selectedCategory ? 'white' : settings.secondaryColor,
              borderWidth: '2px',
              borderColor: settings.primaryColor,
            }}
          >
            {t('qrMenu.all')}
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-4 py-2.5 rounded-full whitespace-nowrap font-medium transition-all duration-200 transform hover:scale-105 flex-shrink-0 ${
                selectedCategory === category.id ? 'shadow-lg' : 'shadow'
              }`}
              style={{
                backgroundColor: selectedCategory === category.id ? settings.primaryColor : 'white',
                color: selectedCategory === category.id ? 'white' : settings.secondaryColor,
                borderWidth: '2px',
                borderColor: settings.primaryColor,
              }}
            >
              {category.name}
            </button>
          ))}
        </div>

        {/* Products */}
        <div>
          {filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <UtensilsCrossed className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">{t('qrMenu.noItemsFound')}</p>
            </div>
          ) : (
            <>
              {/* LIST Layout */}
              {settings.layoutStyle === 'LIST' && (
                <div className="space-y-4">
                  {filteredProducts.map((product) => {
                    const imageUrl = normalizeImageUrl(product.image || product.images?.[0]?.url);
                    return (
                      <button
                        key={product.id}
                        onClick={() => handleProductClick(product)}
                        disabled={!enableCustomerOrdering}
                        className={`w-full text-left transition-all duration-200 transform ${
                          enableCustomerOrdering
                            ? 'hover:scale-102 active:scale-98 cursor-pointer'
                            : 'cursor-default opacity-75'
                        }`}
                      >
                        <Card className="overflow-hidden bg-white shadow-md hover:shadow-lg transition-shadow">
                          <CardContent className="p-0">
                            <div className="flex gap-4">
                              {settings.showImages && (
                                <div className="relative flex-shrink-0 w-28 h-28 sm:w-32 sm:h-32 bg-gray-100 overflow-hidden">
                                  {imageUrl ? (
                                    <img
                                      src={imageUrl}
                                      alt={product.name}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
                                      <UtensilsCrossed className="h-10 w-10 text-gray-400" />
                                    </div>
                                  )}
                                  {product.isAvailable && (
                                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                      <span className="text-white text-xs font-bold">
                                        {t('qrMenu.unavailable')}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                              <div className="flex-1 p-4 flex flex-col justify-between">
                                <div>
                                  <h3
                                    className="text-base sm:text-lg font-bold line-clamp-2"
                                    style={{ color: settings.secondaryColor }}
                                  >
                                    {product.name}
                                  </h3>
                                  {settings.showDescription && product.description && (
                                    <p className="text-xs sm:text-sm text-gray-600 mt-1 line-clamp-2">
                                      {product.description}
                                    </p>
                                  )}
                                </div>
                                {settings.showPrices && (
                                  <p
                                    className="text-lg sm:text-xl font-bold mt-2"
                                    style={{ color: settings.primaryColor }}
                                  >
                                    {formatCurrency(product.price, 'USD')}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center justify-center pr-4 flex-shrink-0">
                                <ChevronRight
                                  className="h-5 w-5"
                                  style={{ color: settings.primaryColor }}
                                />
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* GRID Layout */}
              {settings.layoutStyle === 'GRID' && (
                <div
                  className="grid gap-4 sm:gap-5"
                  style={{
                    gridTemplateColumns: `repeat(auto-fill, minmax(160px, 1fr))`,
                  }}
                >
                  {filteredProducts.map((product) => {
                    const imageUrl = normalizeImageUrl(product.image || product.images?.[0]?.url);
                    return (
                      <button
                        key={product.id}
                        onClick={() => handleProductClick(product)}
                        disabled={!enableCustomerOrdering}
                        className={`text-left transition-all duration-200 transform ${
                          enableCustomerOrdering
                            ? 'hover:scale-105 active:scale-95 cursor-pointer'
                            : 'cursor-default opacity-75'
                        }`}
                      >
                        <Card className="overflow-hidden bg-white shadow-md hover:shadow-lg transition-shadow h-full flex flex-col">
                          <CardContent className="p-0 flex-1 flex flex-col">
                            {settings.showImages && (
                              <div className="relative w-full h-40 bg-gray-100 overflow-hidden flex-shrink-0">
                                {imageUrl ? (
                                  <img
                                    src={imageUrl}
                                    alt={product.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
                                    <UtensilsCrossed className="h-12 w-12 text-gray-400" />
                                  </div>
                                )}
                                {product.isAvailable && (
                                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                    <span className="text-white text-xs font-bold text-center px-2">
                                      {t('qrMenu.unavailable')}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                            <div className="p-3 flex-1 flex flex-col justify-between">
                              <div>
                                <h3
                                  className="text-sm font-bold line-clamp-2"
                                  style={{ color: settings.secondaryColor }}
                                >
                                  {product.name}
                                </h3>
                                {settings.showDescription && product.description && (
                                  <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                                    {product.description}
                                  </p>
                                )}
                              </div>
                              {settings.showPrices && (
                                <p
                                  className="text-base font-bold mt-2"
                                  style={{ color: settings.primaryColor }}
                                >
                                  {formatCurrency(product.price, 'USD')}
                                </p>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* COMPACT Layout */}
              {settings.layoutStyle === 'COMPACT' && (
                <div className="space-y-2">
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => handleProductClick(product)}
                      disabled={!enableCustomerOrdering}
                      className={`w-full text-left transition-all duration-200 transform ${
                        enableCustomerOrdering
                          ? 'hover:scale-102 active:scale-98 cursor-pointer'
                          : 'cursor-default opacity-75'
                      }`}
                    >
                      <Card className="bg-white shadow-md hover:shadow-lg transition-shadow">
                        <CardContent className="p-3 sm:p-4">
                          <div className="flex justify-between items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <h3
                                className="text-sm sm:text-base font-semibold truncate"
                                style={{ color: settings.secondaryColor }}
                              >
                                {product.name}
                              </h3>
                              {product.isAvailable && (
                                <p className="text-xs text-red-500 mt-1">
                                  {t('qrMenu.unavailable')}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {settings.showPrices && (
                                <p
                                  className="text-base sm:text-lg font-bold"
                                  style={{ color: settings.primaryColor }}
                                >
                                  {formatCurrency(product.price, 'USD')}
                                </p>
                              )}
                              <ChevronRight
                                className="h-5 w-5"
                                style={{ color: settings.primaryColor }}
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer - Modern gradient design */}
      <div
        className="shadow-2xl"
        style={{
          background: `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`,
        }}
      >
        {/* Decorative elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -mr-20 -mt-20"></div>
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full -ml-16 -mb-16"></div>
        </div>

        <div className="relative px-4 sm:px-6 py-8 sm:py-10">
          {/* Main content */}
          <div className="text-center mb-6">
            <p className="text-white/90 text-xs sm:text-sm font-semibold uppercase tracking-widest drop-shadow">
              {t('qrMenu.poweredBy')}
            </p>
          </div>

          {/* Divider */}
          <div className="h-px bg-gradient-to-r from-transparent via-white/30 to-transparent mb-6"></div>

          {/* Bottom info */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 text-white/70 text-xs">
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-400"></div>
              Online
            </span>
            <span className="hidden sm:inline">•</span>
            <span>{new Date().getFullYear()} © Restaurant POS</span>
          </div>
        </div>
      </div>

      {/* Product Detail Modal */}
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
      />

      {/* Floating Cart Button - Only show when ordering is enabled */}
      {enableCustomerOrdering && getItemCount() > 0 && tableId && (
        <button
          onClick={() => navigate(`/qr-menu/${tenantId}/cart?tableId=${tableId}`)}
          className="fixed bottom-6 right-6 z-30 p-4 rounded-full shadow-2xl transition-all duration-200 transform hover:scale-110 active:scale-95"
          style={{ backgroundColor: settings.primaryColor }}
        >
          <ShoppingCart className="h-6 w-6 text-white" />
          <span
            className="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-lg"
            style={{ backgroundColor: settings.secondaryColor }}
          >
            {getItemCount()}
          </span>
        </button>
      )}
    </div>
  );
};

export default QRMenuPage;
