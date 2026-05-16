import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, ClipboardList, Home, Award } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { buildQRMenuUrl } from '../../utils/subdomain';

interface QRMenuNavigationProps {
  currentPage: 'menu' | 'cart' | 'orders' | 'loyalty';
  tenantId: string | undefined;
  tableId: string | null;
  sessionId: string | null;
  primaryColor: string;
  secondaryColor: string;
  enableCustomerOrdering: boolean;
  subdomain?: string;
}

const QRMenuNavigation: React.FC<QRMenuNavigationProps> = ({
  currentPage,
  tenantId,
  tableId,
  sessionId,
  primaryColor,
  secondaryColor,
  enableCustomerOrdering,
  subdomain,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const items = useCartStore(state => state.items);
  const [itemCount, setItemCount] = useState(0);

  useEffect(() => {
    const newCount = items.reduce((sum, item) => sum + item.quantity, 0);
    setItemCount(newCount);
  }, [items]);

  const handleNavigation = (page: 'menu' | 'cart' | 'orders' | 'loyalty') => {
    const url = buildQRMenuUrl(page, {
      subdomain,
      tenantId,
      tableId,
      sessionId,
    });
    navigate(url);
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
      {/* Mobile Bottom Menu — same nav items as the desktop nav above,
          but rendered as a fixed bottom bar on phones. Previously this
          imported a separate MobileBottomMenu component that was deleted
          in a refactor; inlining keeps both views in sync going forward. */}
      <div
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80"
        style={{ borderTopColor: secondaryColor + '20' }}
      >
        <div className="flex justify-around items-stretch">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.active;
            const isDisabled = item.disabled;
            return (
              <button
                key={item.id}
                onClick={() => !isDisabled && handleNavigation(item.id as 'menu' | 'cart' | 'orders' | 'loyalty')}
                disabled={isDisabled}
                className={`flex-1 flex flex-col items-center justify-center py-2 text-xs font-medium ${
                  isDisabled
                    ? 'text-slate-300 cursor-not-allowed'
                    : isActive
                      ? ''
                      : 'text-slate-600 hover:text-slate-900'
                }`}
                style={isActive ? { color: primaryColor } : undefined}
              >
                <Icon className="h-5 w-5 mb-1" />
                <span className="truncate">{item.label}</span>
                {item.badge ? (
                  <span
                    className="absolute mt-[-32px] ml-6 inline-flex items-center justify-center rounded-full text-[10px] text-white px-1.5 py-0.5"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tablet & Desktop Navigation - Horizontal Tabs */}
      <nav className="hidden md:flex w-full border-b border-slate-200/60 bg-white overflow-x-auto">
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
                color: isActive ? primaryColor : '#64748B',
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

