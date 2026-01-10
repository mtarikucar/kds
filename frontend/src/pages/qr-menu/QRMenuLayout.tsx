import React, { useState, useEffect, ReactNode } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { UtensilsCrossed, Search } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import QRMenuNavigation from '../../components/qr-menu/QRMenuNavigation';
import { useCartStore } from '../../store/cartStore';

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

export interface MenuData {
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
  categories: any[];
}

interface QRMenuLayoutProps {
  currentPage: 'menu' | 'cart' | 'orders' | 'loyalty';
  children: ReactNode;
  onMenuDataLoaded?: (data: MenuData) => void;
  onSessionIdChange?: (sessionId: string | null) => void;
  onSearchQueryChange?: (query: string) => void;
}

const QRMenuLayout: React.FC<QRMenuLayoutProps> = ({ currentPage, children, onMenuDataLoaded, onSessionIdChange, onSearchQueryChange }) => {
  const { t, i18n } = useTranslation('common');
  const navigate = useNavigate();
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get('tableId');
  const urlSessionId = searchParams.get('sessionId');

  // Get sessionId from cartStore as fallback (URL might not have it but store does)
  const storeSessionId = useCartStore(state => state.sessionId);
  const sessionId = urlSessionId || storeSessionId;

  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const initializeSession = useCartStore(state => state.initializeSession);

  // Fetch menu data - refresh when component mounts or tenantId changes
  useEffect(() => {
    const fetchMenuData = async () => {
      try {
        setIsLoading(true);
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        const url = tableId
          ? `${API_URL}/qr-menu/${tenantId}?tableId=${tableId}&t=${Date.now()}`
          : `${API_URL}/qr-menu/${tenantId}?t=${Date.now()}`;

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
  }, [tenantId, tableId, t]);

  // Initialize cart session
  useEffect(() => {
    if (menuData && tenantId) {
      initializeSession(tenantId, tableId || null, menuData.tenant.currency);
    }
  }, [menuData, tenantId, tableId, initializeSession]);

  // Call onMenuDataLoaded callback when menu data is loaded
  useEffect(() => {
    if (menuData && onMenuDataLoaded) {
      onMenuDataLoaded(menuData);
    }
  }, [menuData, onMenuDataLoaded]);

  // Call onSessionIdChange callback when sessionId changes
  useEffect(() => {
    if (onSessionIdChange) {
      onSessionIdChange(sessionId);
    }
  }, [sessionId, onSessionIdChange]);

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'tr' : 'en';
    i18n.changeLanguage(newLang);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !menuData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <p className="text-red-600 mb-4">{error || t('messages.operationFailed')}</p>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-3 rounded-lg font-semibold text-white"
          style={{ backgroundColor: menuData?.settings.primaryColor || '#FF6B6B' }}
        >
          {t('common.backHome', 'Back Home')}
        </button>
      </div>
    );
  }

  const { settings, tenant, table, enableCustomerOrdering } = menuData;

  return (
    <div
      className="flex flex-col min-h-screen animate-in fade-in duration-300"
      style={{
        backgroundColor: settings.backgroundColor,
        fontFamily: settings.fontFamily,
      }}
    >
      {/* Header - Sticky */}
      <header
        className="sticky top-0 left-0 right-0 z-20 shadow-2xl animate-in slide-in-from-top duration-300"
        style={{
          background: `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`,
        }}
      >
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -mr-20 -mt-20"></div>
          <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full -ml-16 -mb-16"></div>
        </div>

        <div className="relative px-4 sm:px-6 lg:px-8 py-5 sm:py-6 lg:py-7">
          {settings.showRestaurantInfo && (
            <div className="flex items-center gap-4 mb-5">
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
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-400 rounded-full shadow-lg ring-2 ring-white animate-pulse"></div>
              </div>

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

          {/* Search */}
          {currentPage === 'menu' && (
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-white/60 group-focus-within:text-white transition-colors" />
              <input
                type="text"
                placeholder={t('qrMenu.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (onSearchQueryChange) {
                    onSearchQueryChange(e.target.value);
                  }
                }}
                className="w-full pl-12 pr-5 py-3.5 border-0 bg-white/20 backdrop-blur-sm text-white placeholder-white/60 rounded-2xl focus:outline-none focus:ring-2 focus:ring-white/50 focus:bg-white/30 transition-all duration-200 shadow-lg hover:bg-white/25"
              />
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Navigation - Responsive */}
        <QRMenuNavigation
          currentPage={currentPage}
          tenantId={tenantId}
          tableId={tableId}
          sessionId={sessionId}
          primaryColor={settings.primaryColor}
          secondaryColor={settings.secondaryColor}
          enableCustomerOrdering={enableCustomerOrdering}
        />

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto">
          {React.Children.map(children, child => {
            if (React.isValidElement(child)) {
              return React.cloneElement(child as React.ReactElement<any>, { searchQuery });
            }
            return child;
          })}
        </main>
      </div>
    </div>
  );
};

export default QRMenuLayout;

