import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Category, Product } from '../../types';
import { Card, CardContent } from '../../components/ui/Card';
import Spinner from '../../components/ui/Spinner';
import { formatCurrency } from '../../lib/utils';
import { UtensilsCrossed, Search, ChevronRight, ShoppingCart, ClipboardList, Check } from 'lucide-react';
import ProductDetailModalWithCart from './ProductDetailModalWithCart';
import MobileBottomMenu from '../../components/qr-menu/MobileBottomMenu';
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
    currency?: string;
  };
  table?: {
    id: string;
    number: string;
  };
  settings: MenuSettings;
  enableCustomerOrdering: boolean;
  enableTablelessMode: boolean;
  categories: (Category & { products: Product[] })[];
}

const QRMenuPage = () => {
  const { t, i18n } = useTranslation('common');
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
  const [addedProductId, setAddedProductId] = useState<string | null>(null);

  // Cart state
  const initializeSession = useCartStore(state => state.initializeSession);
  const addItem = useCartStore(state => state.addItem);

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
    if (menuData && tenantId) {
      initializeSession(tenantId, tableId || null, menuData.tenant.currency);
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

  const { tenant, table, settings, enableCustomerOrdering, enableTablelessMode, categories } = menuData;

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
    setSelectedProduct(product);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedProduct(null);
  };

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'tr' : 'en';
    i18n.changeLanguage(newLang);
  };

  return (
    <div
      className="flex flex-col min-h-screen animate-in fade-in duration-300"
      style={{
        backgroundColor: settings.backgroundColor,
        fontFamily: settings.fontFamily,
      }}
    >
      {/* Header - Modern gradient design - Fixed */}
      <div
        className="sticky top-0 left-0 right-0 z-20 shadow-2xl animate-in slide-in-from-top duration-300"
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


              {/* Language Toggle */}
              <button
                onClick={toggleLanguage}
                className="flex-shrink-0 px-3 py-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-xl shadow-lg transition-all duration-200 transform hover:scale-105 active:scale-95"
              >
                <span className="text-white font-semibold text-sm">
                  {i18n.language === 'en' ? 'TR' : 'EN'}
                </span>
              </button>
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


      <div className="flex-1 px-4 sm:px-6 py-6">
        {/* Categories - Horizontal Scroll */}
        <div className="mb-8 flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 sm:mx-0 sm:px-0">
          <button
            onClick={() => setSelectedCategory('')}
            className={`px-4 py-2.5 rounded-full whitespace-nowrap font-medium transition-all duration-200 transform hover:scale-105 flex-shrink-0 ${!selectedCategory ? 'shadow-lg' : 'shadow'
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
              className={`px-4 py-2.5 rounded-full whitespace-nowrap font-medium transition-all duration-200 transform hover:scale-105 flex-shrink-0 ${selectedCategory === category.id ? 'shadow-lg' : 'shadow'
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
              {/* LIST Layout - Enhanced Horizontal Cards */}
              {settings.layoutStyle === 'LIST' && (
                <div className="space-y-3">
                  {filteredProducts.map((product, index) => {
                    const imageUrl = normalizeImageUrl(product.image || product.images?.[0]?.url);
                    return (
                      <button
                        key={product.id}
                        onClick={() => handleProductClick(product)}
                        className="w-full text-left transition-all duration-300 transform animate-in fade-in slide-in-from-left hover:shadow-xl active:scale-98 cursor-pointer"
                        style={{ animationDelay: `${index * 20}ms` }}
                      >
                        <Card className="overflow-hidden bg-white shadow-lg hover:shadow-2xl transition-all duration-300 border-2 border-transparent hover:border-opacity-20" style={{ '--tw-border-opacity': '0.2', borderColor: settings.primaryColor } as React.CSSProperties}>
                          <CardContent className="p-0">
                            <div className="flex items-stretch h-28">
                              {/* Left: Image Section */}
                              {settings.showImages && (
                                <div className="relative flex-shrink-0 w-36 overflow-hidden">
                                  {imageUrl ? (
                                    <>
                                      <img
                                        src={imageUrl}
                                        alt={product.name}
                                        className="w-full h-full object-cover hover:scale-110 transition-transform duration-500"
                                      />
                                      <div className="absolute inset-0 bg-gradient-to-r from-transparent to-black/20" />
                                    </>
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${settings.primaryColor}20 0%, ${settings.secondaryColor}20 100%)` }}>
                                      <UtensilsCrossed className="h-10 w-10" style={{ color: settings.primaryColor, opacity: 0.4 }} />
                                    </div>
                                  )}

                                  {/* Unavailable Badge */}
                                  {product.isAvailable && (
                                    <div className="absolute top-1 right-1">
                                      <span className="px-2 py-0.5 rounded-full text-xs font-bold text-white bg-red-500 shadow-lg">
                                        N/A
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Right: Content Section */}
                              <div className="flex-1 flex items-center justify-between px-5 gap-4">
                                {/* Product Info */}
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-bold text-lg line-clamp-1 mb-1" style={{ color: settings.secondaryColor }}>
                                    {product.name}
                                  </h3>
                                  {settings.showDescription && product.description && (
                                    <p className="text-sm text-gray-500 line-clamp-1 mb-1.5">
                                      {product.description}
                                    </p>
                                  )}
                                  {settings.showPrices && (
                                    <p className="text-2xl font-black" style={{
                                      background: `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`,
                                      WebkitBackgroundClip: 'text',
                                      WebkitTextFillColor: 'transparent',
                                      backgroundClip: 'text'
                                    }}>
                                      {formatCurrency(product.price, tenant?.currency || 'TRY')}
                                    </p>
                                  )}
                                </div>

                                {/* Add Button */}
                                {enableCustomerOrdering && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const allModifiers = product.modifierGroups || [];
                                      const hasRequiredModifiers = allModifiers.some(g => g.isRequired);
                                      if (hasRequiredModifiers) {
                                        handleProductClick(product);
                                      } else {
                                        addItem(product, 1, []);
                                        setAddedProductId(product.id);
                                        setTimeout(() => setAddedProductId(null), 1500);
                                      }
                                    }}
                                    className={`font-bold px-5 py-3 rounded-lg transition-all flex items-center justify-center gap-2 flex-shrink-0 min-w-[110px] shadow-md ${addedProductId === product.id
                                        ? 'bg-green-500 scale-105 animate-pulse'
                                        : 'hover:scale-105 active:scale-95'
                                      }`}
                                    style={{
                                      background: addedProductId === product.id ? '#10b981' : `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`,
                                      color: 'white'
                                    }}
                                  >
                                    {addedProductId === product.id ? (
                                      <>
                                        <Check className="h-5 w-5" />
                                        <span className="text-sm hidden md:inline">{t('qrMenu.added')}</span>
                                      </>
                                    ) : (
                                      <>
                                        <ShoppingCart className="h-5 w-5" />
                                        <span className="text-sm hidden md:inline">{t('qrMenu.addToCart')}</span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* GRID Layout - Enhanced Modern Design */}
              {settings.layoutStyle === 'GRID' && (
                <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {filteredProducts.map((product, index) => {
                    const imageUrl = normalizeImageUrl(product.image || product.images?.[0]?.url);
                    return (
                      <button
                        key={product.id}
                        onClick={() => handleProductClick(product)}
                        className="group text-left transition-all duration-300 transform animate-in fade-in zoom-in-95 hover:-translate-y-1 active:scale-95 cursor-pointer"
                        style={{ animationDelay: `${index * 30}ms` }}
                      >
                        <Card className="overflow-hidden bg-white shadow-lg hover:shadow-2xl transition-all duration-300 h-56 relative">
                          {/* Background Image with Overlay */}
                          <div className="absolute inset-0">
                            {settings.showImages && imageUrl ? (
                              <>
                                <img
                                  src={imageUrl}
                                  alt={product.name}
                                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
                              </>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${settings.primaryColor}15 0%, ${settings.secondaryColor}15 100%)` }}>
                                <UtensilsCrossed className="h-16 w-16 text-gray-300" />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                              </div>
                            )}

                            {/* Unavailable Badge */}
                            {product.isAvailable && (
                              <div className="absolute top-2 right-2">
                                <span className="px-3 py-1 rounded-full text-xs font-bold text-white bg-red-500/90 backdrop-blur-sm shadow-lg">
                                  {t('qrMenu.unavailable')}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Content Overlay */}
                          <CardContent className="absolute inset-0 p-4 flex flex-col justify-between">
                            {/* Top: Product Name */}
                            <div>
                              <h3 className="font-bold text-white text-base leading-tight line-clamp-2 drop-shadow-lg">
                                {product.name}
                              </h3>
                              {settings.showDescription && product.description && (
                                <p className="text-white/90 text-xs mt-1.5 line-clamp-1 drop-shadow-md">
                                  {product.description}
                                </p>
                              )}
                            </div>

                            {/* Bottom: Price & Add Button */}
                            <div className="space-y-2.5">
                              {settings.showPrices && (
                                <p className="text-white font-black text-2xl drop-shadow-lg">
                                  {formatCurrency(product.price, tenant?.currency || 'TRY')}
                                </p>
                              )}

                              {enableCustomerOrdering && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const allModifiers = product.modifierGroups || [];
                                    const hasRequiredModifiers = allModifiers.some(g => g.isRequired);
                                    if (hasRequiredModifiers) {
                                      handleProductClick(product);
                                    } else {
                                      addItem(product, 1, []);
                                      setAddedProductId(product.id);
                                      setTimeout(() => setAddedProductId(null), 1500);
                                    }
                                  }}
                                  className={`w-full font-bold py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2 backdrop-blur-sm shadow-lg ${addedProductId === product.id
                                      ? 'bg-green-500/95 scale-105 animate-pulse'
                                      : 'bg-white/95 hover:bg-white hover:scale-105 active:scale-95'
                                    }`}
                                  style={{
                                    color: addedProductId === product.id ? 'white' : settings.primaryColor,
                                  }}
                                >
                                  {addedProductId === product.id ? (
                                    <>
                                      <Check className="h-5 w-5" />
                                      <span className="text-sm">{t('qrMenu.added')}</span>
                                    </>
                                  ) : (
                                    <>
                                      <ShoppingCart className="h-5 w-5" />
                                      <span className="text-sm">{t('qrMenu.addToCart')}</span>
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* COMPACT Layout - Minimal Clean Design */}
              {settings.layoutStyle === 'COMPACT' && (
                <div className="space-y-2">
                  {filteredProducts.map((product, index) => (
                    <button
                      key={product.id}
                      onClick={() => handleProductClick(product)}
                      className="w-full text-left transition-all duration-300 transform animate-in fade-in slide-in-from-left hover:shadow-lg active:scale-98 cursor-pointer"
                      style={{ animationDelay: `${index * 20}ms` }}
                    >
                      <Card className="bg-white shadow-md hover:shadow-xl transition-all duration-300 border-l-4" style={{ borderLeftColor: settings.primaryColor }}>
                        <CardContent className="p-4">
                          <div className="flex justify-between items-center gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-base font-bold truncate" style={{ color: settings.secondaryColor }}>
                                  {product.name}
                                </h3>
                                {product.isAvailable && (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-bold text-white bg-red-500 flex-shrink-0">
                                    {t('qrMenu.unavailable')}
                                  </span>
                                )}
                              </div>
                              {settings.showPrices && (
                                <p className="text-lg font-black" style={{
                                  background: `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`,
                                  WebkitBackgroundClip: 'text',
                                  WebkitTextFillColor: 'transparent',
                                  backgroundClip: 'text'
                                }}>
                                  {formatCurrency(product.price, tenant?.currency || 'TRY')}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {enableCustomerOrdering && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const allModifiers = product.modifierGroups || [];
                                    const hasRequiredModifiers = allModifiers.some(g => g.isRequired);
                                    if (hasRequiredModifiers) {
                                      handleProductClick(product);
                                    } else {
                                      addItem(product, 1, []);
                                      setAddedProductId(product.id);
                                      setTimeout(() => setAddedProductId(null), 1500);
                                    }
                                  }}
                                  className={`p-3 rounded-lg transition-all duration-300 shadow-md ${addedProductId === product.id
                                      ? 'scale-110 animate-pulse bg-green-500'
                                      : 'hover:scale-110 active:scale-95'
                                    }`}
                                  style={{
                                    background: addedProductId === product.id ? '#10b981' : `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`,
                                  }}
                                  title={t('qrMenu.addToCart', 'Add to Cart')}
                                >
                                  {addedProductId === product.id ? (
                                    <Check className="h-5 w-5 text-white" />
                                  ) : (
                                    <ShoppingCart className="h-5 w-5 text-white" />
                                  )}
                                </button>
                              )}
                              <ChevronRight
                                className="h-5 w-5"
                                style={{ color: settings.primaryColor, opacity: 0.5 }}
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
        className="relative shadow-2xl mt-12 mb-20"
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
            <span>{new Date().getFullYear()} © HummyTummy</span>
            {import.meta.env.VITE_APP_VERSION && (
              <>
                <span className="hidden sm:inline">•</span>
                <span className="text-xs">v{import.meta.env.VITE_APP_VERSION.replace('v', '')}</span>
              </>
            )}
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
        currency={tenant?.currency || 'TRY'}
      />

      {/* Mobile Bottom Menu */}
      <MobileBottomMenu
        tenantId={tenantId}
        tableId={tableId}
        primaryColor={settings.primaryColor}
        secondaryColor={settings.secondaryColor}
        currentPage="menu"
      />
    </div>
  );
};

export default QRMenuPage;
