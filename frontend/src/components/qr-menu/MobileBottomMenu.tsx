import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShoppingCart, ClipboardList, Home } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';

interface MobileBottomMenuProps {
  tenantId: string | undefined;
  tableId: string | null;
  primaryColor: string;
  secondaryColor: string;
  currentPage: 'menu' | 'cart' | 'orders';
}

const MobileBottomMenu: React.FC<MobileBottomMenuProps> = ({
  tenantId,
  tableId,
  primaryColor,
  secondaryColor,
  currentPage,
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

  const handleMenuClick = () => {
    navigate(`/qr-menu/${tenantId}${tableId ? `?tableId=${tableId}` : ''}`);
  };

  const handleCartClick = () => {
    navigate(`/qr-menu/${tenantId}/cart${tableId ? `?tableId=${tableId}` : ''}`);
  };

  const handleOrdersClick = () => {
    if (sessionId) {
      navigate(`/qr-menu/${tenantId}/orders?tableId=${tableId}&sessionId=${sessionId}`);
    }
  };

  const menuItems = [
    {
      id: 'menu',
      label: t('common.browseMenu', 'Menu'),
      icon: Home,
      onClick: handleMenuClick,
      active: currentPage === 'menu',
    },
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
  ];

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden"
      style={{
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(10px)',
        borderTop: '1px solid rgba(0, 0, 0, 0.08)',
        boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.08)',
      }}
    >
      <div className="flex items-center justify-around px-2 py-3 max-w-md mx-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.active;
          const isDisabled = item.disabled;

          return (
            <button
              key={item.id}
              onClick={item.onClick}
              disabled={isDisabled}
              className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg transition-all duration-200 relative ${
                isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
              }`}
              style={{
                backgroundColor: isActive ? `${primaryColor}10` : 'transparent',
              }}
              title={item.label}
            >
              <div className="relative">
                <Icon
                  className="h-6 w-6 transition-colors duration-200"
                  style={{
                    color: isActive ? primaryColor : '#999',
                    strokeWidth: isActive ? 2.5 : 2,
                  }}
                />
                {/* Badge for cart count */}
                {item.badge && (
                  <span
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{
                      backgroundColor: secondaryColor,
                      fontSize: '10px',
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </div>
              <span
                className="text-xs font-medium transition-colors duration-200"
                style={{
                  color: isActive ? primaryColor : '#666',
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default MobileBottomMenu;

