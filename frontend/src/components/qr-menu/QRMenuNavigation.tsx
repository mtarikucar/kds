import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, ClipboardList, Home, Award } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import MobileBottomMenu from './MobileBottomMenu';

interface QRMenuNavigationProps {
  currentPage: 'menu' | 'cart' | 'orders' | 'loyalty';
  tenantId: string | undefined;
  tableId: string | null;
  sessionId: string | null;
  primaryColor: string;
  secondaryColor: string;
  enableCustomerOrdering: boolean;
}

const QRMenuNavigation: React.FC<QRMenuNavigationProps> = ({
  currentPage,
  tenantId,
  tableId,
  sessionId,
  primaryColor,
  secondaryColor,
  enableCustomerOrdering,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const items = useCartStore(state => state.items);
  const [itemCount, setItemCount] = useState(0);

  useEffect(() => {
    const newCount = items.reduce((sum, item) => sum + item.quantity, 0);
    setItemCount(newCount);
  }, [items]);

  const handleNavigation = (page: string) => {
    const baseUrl = `/qr-menu/${tenantId}`;
    const params = tableId ? `?tableId=${tableId}` : '';
    const sessionParam = sessionId ? `&sessionId=${sessionId}` : '';

    switch (page) {
      case 'menu':
        navigate(`${baseUrl}${params}`);
        break;
      case 'cart':
        navigate(`${baseUrl}/cart${params}`);
        break;
      case 'orders':
        navigate(`${baseUrl}/orders${params}${sessionParam}`);
        break;
      case 'loyalty':
        navigate(`${baseUrl}/loyalty${params}${sessionParam}`);
        break;
    }
  };

  // Build nav items based on enableCustomerOrdering
  const navItems = [
    {
      id: 'menu',
      label: t('common.browseMenu', 'Menu'),
      icon: Home,
      onClick: () => handleNavigation('menu'),
      active: currentPage === 'menu',
    },
    // Only show Cart and Orders if customer ordering is enabled
    ...(enableCustomerOrdering ? [
      {
        id: 'cart',
        label: t('cart.title', 'Cart'),
        icon: ShoppingCart,
        onClick: () => handleNavigation('cart'),
        active: currentPage === 'cart',
        badge: itemCount > 0 ? itemCount : null,
      },
      {
        id: 'orders',
        label: t('orders.title', 'Orders'),
        icon: ClipboardList,
        onClick: () => handleNavigation('orders'),
        active: currentPage === 'orders',
        disabled: !sessionId,
      },
    ] : []),
    {
      id: 'loyalty',
      label: t('loyalty.rewards', 'Rewards'),
      icon: Award,
      onClick: () => handleNavigation('loyalty'),
      active: currentPage === 'loyalty',
      disabled: !sessionId,
    },
  ];

  return (
    <>
      {/* Mobile Bottom Menu - md:hidden means hidden on tablet and above */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50">
        <MobileBottomMenu
          tenantId={tenantId}
          tableId={tableId}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          currentPage={currentPage}
          enableCustomerOrdering={enableCustomerOrdering}
        />
      </div>

      {/* Tablet & Desktop Navigation - Horizontal Tabs */}
      <nav className="hidden md:flex w-full border-b border-gray-200 bg-white overflow-x-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.active;
          const isDisabled = item.disabled;

          return (
            <button
              key={item.id}
              onClick={item.onClick}
              disabled={isDisabled}
              className={`px-4 py-3 border-b-2 transition-all duration-200 flex items-center justify-center gap-2 whitespace-nowrap ${
                isActive
                  ? 'border-b-2'
                  : 'border-b-2 border-transparent'
              } ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
              style={{
                borderBottomColor: isActive ? primaryColor : 'transparent',
                color: isActive ? primaryColor : '#6B7280',
              }}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              <span className="font-medium text-sm">{item.label}</span>
              {item.badge && (
                <span
                  className="ml-1 px-2 py-0.5 rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: primaryColor }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>


    </>
  );
};

export default QRMenuNavigation;

