import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, ClipboardList, Home, Award } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { buildQRMenuUrl } from '../../utils/subdomain';

interface MobileBottomMenuProps {
  tenantId: string | undefined;
  tableId: string | null;
  primaryColor: string;
  secondaryColor: string;
  currentPage: 'menu' | 'cart' | 'orders' | 'loyalty';
  enableCustomerOrdering: boolean;
  subdomain?: string;
}

const MobileBottomMenu: React.FC<MobileBottomMenuProps> = ({
  tenantId,
  tableId,
  primaryColor,
  secondaryColor,
  currentPage,
  enableCustomerOrdering,
  subdomain,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const items = useCartStore(state => state.items);
  const sessionId = useCartStore(state => state.sessionId);
  const [itemCount, setItemCount] = useState(0);

  // Update item count
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

  const handleMenuClick = () => handleNavigation('menu');
  const handleCartClick = () => handleNavigation('cart');
  const handleOrdersClick = () => {
    if (sessionId) handleNavigation('orders');
  };
  const handleLoyaltyClick = () => {
    if (sessionId) handleNavigation('loyalty');
  };

  // Build menu items based on enableCustomerOrdering
  const menuItems = [
    {
      id: 'menu',
      label: t('common.browseMenu', 'Menu'),
      icon: Home,
      onClick: handleMenuClick,
      active: currentPage === 'menu',
    },
    // Only show Cart and Orders if customer ordering is enabled
    ...(enableCustomerOrdering ? [
      {
        id: 'cart',
        label: t('cart.title', 'Cart'),
        icon: ShoppingCart,
        onClick: handleCartClick,
        active: currentPage === 'cart',
        badge: itemCount > 0 ? itemCount : null,
      },
      {
        id: 'orders',
        label: t('orders.title', 'Orders'),
        icon: ClipboardList,
        onClick: handleOrdersClick,
        active: currentPage === 'orders',
        disabled: !sessionId,
      },
    ] : []),
    {
      id: 'loyalty',
      label: t('loyalty.rewards', 'Rewards'),
      icon: Award,
      onClick: handleLoyaltyClick,
      active: currentPage === 'loyalty',
      disabled: !sessionId,
    },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 md:hidden">
      {/* Gradient Background with Blur Effect */}
      <div
        className="absolute inset-0 backdrop-blur-xl"
        style={{
          background: `linear-gradient(to top, ${primaryColor}15, ${secondaryColor}08, transparent)`,
        }}
      />
      
      {/* Glass Morphism Container - Compact */}
      <div
        className="relative mx-3 mb-3 rounded-2xl shadow-xl overflow-hidden"
        style={{
          background: 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
        }}
      >
        {/* Top Gradient Accent Line - Thinner */}
        <div
          className="h-0.5"
          style={{
            background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor}, ${primaryColor})`,
            backgroundSize: '200% 100%',
            animation: 'shimmer 3s ease-in-out infinite',
          }}
        />
        
        <div className="flex items-center justify-around px-2 py-2.5">
          {menuItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = item.active;
            const isDisabled = item.disabled;

            return (
              <button
                key={item.id}
                onClick={item.onClick}
                disabled={isDisabled}
                className={`flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-xl transition-all duration-300 relative group ${
                  isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer active:scale-90'
                }`}
                style={{
                  backgroundColor: isActive ? `${primaryColor}12` : 'transparent',
                  transform: isActive ? 'translateY(-2px)' : 'translateY(0)',
                  animationDelay: `${index * 100}ms`,
                }}
                title={item.label}
              >
                {/* Active Indicator - Top Dot - Smaller */}
                {isActive && (
                  <div
                    className="absolute -top-0.5 left-1/2 transform -translate-x-1/2 w-1 h-1 rounded-full animate-pulse"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                      boxShadow: `0 0 6px ${primaryColor}60`,
                    }}
                  />
                )}

                {/* Icon Container - Compact */}
                <div
                  className={`relative p-1.5 rounded-xl transition-all duration-300 ${
                    isActive ? 'scale-105' : 'group-hover:scale-102'
                  }`}
                  style={{
                    background: isActive
                      ? `linear-gradient(135deg, ${primaryColor}18, ${secondaryColor}18)`
                      : 'transparent',
                    boxShadow: isActive ? `0 2px 8px ${primaryColor}25` : 'none',
                  }}
                >
                  <Icon
                    className="h-5 w-5 transition-all duration-300"
                    style={{
                      color: isActive ? primaryColor : '#6b7280',
                      strokeWidth: isActive ? 2.5 : 2,
                      filter: isActive ? `drop-shadow(0 1px 2px ${primaryColor}30)` : 'none',
                    }}
                  />
                  
                  {/* Badge - Smaller */}
                  {item.badge && (
                    <span
                      className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-white shadow-md"
                      style={{
                        background: `linear-gradient(135deg, ${secondaryColor}, ${primaryColor})`,
                        fontSize: '9px',
                        fontWeight: '800',
                        boxShadow: `0 1px 4px ${secondaryColor}50`,
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>

                {/* Label - Smaller Font */}
                <span
                  className={`text-[10px] font-semibold transition-all duration-300 ${
                    isActive ? 'scale-102' : ''
                  }`}
                  style={{
                    color: isActive ? primaryColor : '#6b7280',
                    textShadow: isActive ? `0 0.5px 1px ${primaryColor}25` : 'none',
                  }}
                >
                  {item.label}
                </span>

                {/* Ripple Effect - Subtle */}
                {isActive && (
                  <div
                    className="absolute inset-0 rounded-xl animate-ping opacity-15"
                    style={{
                      background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                      animationDuration: '2s',
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Add keyframe animation for shimmer effect */}
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
};

export default MobileBottomMenu;

