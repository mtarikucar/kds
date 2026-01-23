import React, { useState, useEffect, ReactNode } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, UtensilsCrossed, X, ShoppingCart } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import MenuDrawer from '../../components/qr-menu/MenuDrawer';
import { useCartStore } from '../../store/cartStore';
import { buildQRMenuUrl } from '../../utils/subdomain';
import { formatCurrency } from '../../lib/utils';
import { RTL_LANGUAGES } from '../../i18n/config';

// Helper to normalize image URLs
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

export interface MenuSettings {
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

export interface WifiInfo {
  ssid: string;
  password?: string;
}

export interface SocialMedia {
  instagram?: string;
  facebook?: string;
  twitter?: string;
  tiktok?: string;
  youtube?: string;
  whatsapp?: string;
}

export interface MenuData {
  tenant: {
    id: string;
    name: string;
    currency?: string;
    wifi?: WifiInfo | null;
    socialMedia?: SocialMedia;
  };
  table?: {
    id: string;
    number: string;
  };
  settings: MenuSettings;
  enableCustomerOrdering: boolean;
  enableTablelessMode: boolean;
  categories: any[];
}

interface QRMenuLayoutProps {
  currentPage: 'menu' | 'cart' | 'orders' | 'loyalty';
  children: ReactNode;
  onMenuDataLoaded?: (data: MenuData) => void;
  onSessionIdChange?: (sessionId: string | null) => void;
  onSearchQueryChange?: (query: string) => void;
  subdomain?: string;
}

const QRMenuLayout: React.FC<QRMenuLayoutProps> = ({
  currentPage,
  children,
  onMenuDataLoaded,
  onSessionIdChange,
  subdomain,
}) => {
  const { t, i18n } = useTranslation('common');
  const navigate = useNavigate();
  const { tenantId: urlTenantId } = useParams<{ tenantId: string }>();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get('tableId');
  const urlSessionId = searchParams.get('sessionId');

  const storeSessionId = useCartStore(state => state.sessionId);
  const sessionId = urlSessionId || storeSessionId;

  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const initializeSession = useCartStore(state => state.initializeSession);
  const cartItems = useCartStore(state => state.items);
  const getTotal = useCartStore(state => state.getTotal);

  const isSubdomainMode = !!subdomain;
  const tenantId = menuData?.tenant?.id || urlTenantId;

  // Fetch menu data
  useEffect(() => {
    const fetchMenuData = async () => {
      try {
        setIsLoading(true);
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

        let url: string;
        if (isSubdomainMode && subdomain) {
          url = tableId
            ? `${API_URL}/qr-menu/by-subdomain/${subdomain}?tableId=${tableId}&t=${Date.now()}`
            : `${API_URL}/qr-menu/by-subdomain/${subdomain}?t=${Date.now()}`;
        } else {
          url = tableId
            ? `${API_URL}/qr-menu/${urlTenantId}?tableId=${tableId}&t=${Date.now()}`
            : `${API_URL}/qr-menu/${urlTenantId}?t=${Date.now()}`;
        }

        const response = await axios.get(url);
        setMenuData(response.data);
        setIsLoading(false);
      } catch (err: any) {
        console.error('Error fetching menu data:', err);
        setError(err.response?.data?.message || t('messages.operationFailed'));
        setIsLoading(false);
      }
    };

    if (isSubdomainMode ? subdomain : urlTenantId) {
      fetchMenuData();
    }
  }, [urlTenantId, subdomain, isSubdomainMode, tableId, t]);

  // Initialize cart session
  useEffect(() => {
    if (menuData && tenantId) {
      initializeSession(tenantId, tableId || null, menuData.tenant.currency);
    }
  }, [menuData, tenantId, tableId, initializeSession]);

  // Call onMenuDataLoaded callback
  useEffect(() => {
    if (menuData && onMenuDataLoaded) {
      onMenuDataLoaded(menuData);
    }
  }, [menuData, onMenuDataLoaded]);

  // Call onSessionIdChange callback
  useEffect(() => {
    if (onSessionIdChange) {
      onSessionIdChange(sessionId);
    }
  }, [sessionId, onSessionIdChange]);

  // Check if current language is RTL
  const isRTL = RTL_LANGUAGES.includes(i18n.language);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <Spinner size="lg" />
          <p className="text-slate-500 text-sm animate-pulse">{t('common.loading', 'Loading...')}</p>
        </motion.div>
      </div>
    );
  }

  if (error || !menuData) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4"
      >
        <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mb-4">
          <X className="h-10 w-10 text-red-500" />
        </div>
        <p className="text-red-600 mb-4 text-center">{error || t('messages.operationFailed')}</p>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-3 rounded-xl font-semibold text-white transition-all hover:scale-105 active:scale-95"
          style={{ backgroundColor: menuData?.settings.primaryColor || '#FF6B6B' }}
        >
          {t('common.backHome', 'Back Home')}
        </button>
      </motion.div>
    );
  }

  const { settings, tenant, table, enableCustomerOrdering } = menuData;
  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  const handleCartClick = () => {
    const url = buildQRMenuUrl('cart', {
      subdomain,
      tenantId,
      tableId,
      sessionId,
    });
    navigate(url);
  };

  return (
    <div
      className="flex flex-col min-h-screen"
      dir={isRTL ? 'rtl' : 'ltr'}
      style={{
        backgroundColor: settings.backgroundColor,
        fontFamily: settings.fontFamily,
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {/* Simple Header */}
      <header
        className="sticky top-0 left-0 right-0 z-30 bg-white border-b border-slate-100 shadow-sm"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          {/* Hamburger Menu */}
          <motion.button
            onClick={() => setIsDrawerOpen(true)}
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
            whileTap={{ scale: 0.95 }}
          >
            <Menu className="h-6 w-6 text-slate-700" />
          </motion.button>

          {/* Logo & Restaurant Name */}
          <div className="flex items-center gap-2 flex-1 justify-center">
            {normalizeImageUrl(settings.logoUrl) ? (
              <img
                src={normalizeImageUrl(settings.logoUrl)!}
                alt={tenant.name}
                className="w-8 h-8 rounded-lg object-cover"
              />
            ) : (
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: settings.primaryColor }}
              >
                <UtensilsCrossed className="h-4 w-4 text-white" />
              </div>
            )}
            <h1 className="font-bold text-slate-900 truncate max-w-[180px]">{tenant.name}</h1>
          </div>

          {/* Table Badge */}
          {table && (
            <div
              className="px-3 py-1.5 rounded-full text-sm font-semibold"
              style={{
                backgroundColor: `${settings.primaryColor}15`,
                color: settings.primaryColor,
              }}
            >
              #{table.number}
            </div>
          )}
          {!table && <div className="w-10" />}
        </div>
      </header>

      {/* Menu Drawer */}
      <MenuDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        tenant={tenant}
        table={table}
        settings={settings}
        sessionId={sessionId}
        subdomain={subdomain}
      />

      {/* Main Content */}
      <main className="flex-1">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {React.Children.map(children, child => {
            if (React.isValidElement(child)) {
              return React.cloneElement(child as React.ReactElement<any>, {});
            }
            return child;
          })}
        </motion.div>

        {/* Bottom safe area spacer for floating cart */}
        <div
          className="h-24"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        />
      </main>

      {/* Floating Cart Button */}
      <AnimatePresence>
        {enableCustomerOrdering && itemCount > 0 && currentPage !== 'cart' && (
          <motion.button
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={handleCartClick}
            className="fixed bottom-6 left-4 right-4 z-40 flex items-center justify-between px-5 py-4 rounded-2xl shadow-2xl"
            style={{
              backgroundColor: settings.primaryColor,
              paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
              boxShadow: `0 10px 40px ${settings.primaryColor}50`,
            }}
            whileTap={{ scale: 0.98 }}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <ShoppingCart className="h-6 w-6 text-white" />
                <span
                  className="absolute -top-2 -right-2 min-w-[20px] h-5 flex items-center justify-center px-1.5 rounded-full text-xs font-bold"
                  style={{
                    backgroundColor: settings.secondaryColor,
                    color: 'white',
                  }}
                >
                  {itemCount}
                </span>
              </div>
              <span className="text-white font-semibold">
                {t('cart.viewCart', 'View Cart')}
              </span>
            </div>
            <span className="text-white font-bold text-lg">
              {formatCurrency(getTotal(), tenant.currency || 'TRY')}
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};

export default QRMenuLayout;
