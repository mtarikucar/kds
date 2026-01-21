import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, ClipboardList, Home, Award } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { buildQRMenuUrl } from '../../utils/subdomain';
import { cn } from '../../lib/utils';

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
  const [prevCount, setPrevCount] = useState(0);
  const [badgeBounce, setBadgeBounce] = useState(false);

  // Haptic feedback helper
  const triggerHaptic = (type: 'light' | 'medium' | 'heavy' = 'light') => {
    if ('vibrate' in navigator) {
      const patterns = {
        light: [10],
        medium: [20],
        heavy: [30],
      };
      navigator.vibrate(patterns[type]);
    }
  };

  // Update item count with animation
  useEffect(() => {
    const newCount = items.reduce((sum, item) => sum + item.quantity, 0);

    if (newCount !== itemCount) {
      setPrevCount(itemCount);
      setItemCount(newCount);

      // Trigger bounce animation when count increases
      if (newCount > prevCount) {
        setBadgeBounce(true);
        triggerHaptic('light');
        setTimeout(() => setBadgeBounce(false), 300);
      }
    }
  }, [items, itemCount, prevCount]);

  const handleNavigation = (page: 'menu' | 'cart' | 'orders' | 'loyalty') => {
    if (page === currentPage) return;

    triggerHaptic('light');

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
    <div
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {/* Background with blur */}
      <div
        className="absolute inset-0 backdrop-blur-xl"
        style={{
          background: `linear-gradient(to top, ${primaryColor}15, ${secondaryColor}08, transparent)`,
        }}
      />

      {/* Glass Morphism Container */}
      <div
        className="relative mx-3 mb-3 rounded-2xl shadow-xl overflow-hidden"
        style={{
          background: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.5)',
        }}
      >
        {/* Top Gradient Accent Line */}
        <div
          className="h-0.5"
          style={{
            background: `linear-gradient(90deg, ${primaryColor}, ${secondaryColor}, ${primaryColor})`,
            backgroundSize: '200% 100%',
            animation: 'shimmer 3s ease-in-out infinite',
          }}
        />

        <div className="flex items-center justify-around px-2 py-2.5">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.active;
            const isDisabled = item.disabled;

            return (
              <motion.button
                key={item.id}
                onClick={item.onClick}
                disabled={isDisabled}
                className={cn(
                  'flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all duration-200 relative',
                  isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                )}
                style={{
                  backgroundColor: isActive ? `${primaryColor}12` : 'transparent',
                }}
                whileTap={!isDisabled ? { scale: 0.9 } : {}}
                animate={{
                  y: isActive ? -2 : 0,
                }}
              >
                {/* Active Indicator Dot */}
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      className="absolute -top-0.5 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 rounded-full"
                      style={{
                        background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
                        boxShadow: `0 0 8px ${primaryColor}60`,
                      }}
                    />
                  )}
                </AnimatePresence>

                {/* Icon Container */}
                <div
                  className={cn(
                    'relative p-1.5 rounded-xl transition-all duration-200',
                    isActive && 'scale-105'
                  )}
                  style={{
                    background: isActive
                      ? `linear-gradient(135deg, ${primaryColor}18, ${secondaryColor}18)`
                      : 'transparent',
                    boxShadow: isActive ? `0 2px 8px ${primaryColor}25` : 'none',
                  }}
                >
                  <Icon
                    className="h-5 w-5 transition-all duration-200"
                    style={{
                      color: isActive ? primaryColor : '#64748b',
                      strokeWidth: isActive ? 2.5 : 2,
                      filter: isActive ? `drop-shadow(0 1px 2px ${primaryColor}30)` : 'none',
                    }}
                  />

                  {/* Badge with Animation */}
                  <AnimatePresence>
                    {item.badge && (
                      <motion.span
                        key={item.badge}
                        initial={{ scale: 0 }}
                        animate={{
                          scale: badgeBounce && item.id === 'cart' ? [1, 1.3, 1] : 1,
                        }}
                        exit={{ scale: 0 }}
                        className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-white"
                        style={{
                          background: `linear-gradient(135deg, ${secondaryColor}, ${primaryColor})`,
                          fontSize: '10px',
                          fontWeight: '700',
                          boxShadow: `0 2px 6px ${secondaryColor}50`,
                        }}
                      >
                        {item.badge > 99 ? '99+' : item.badge}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>

                {/* Label */}
                <span
                  className="text-[10px] font-semibold transition-all duration-200"
                  style={{
                    color: isActive ? primaryColor : '#64748b',
                    textShadow: isActive ? `0 0.5px 1px ${primaryColor}25` : 'none',
                  }}
                >
                  {item.label}
                </span>

                {/* Ripple Effect on Active */}
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0.3 }}
                      animate={{ scale: 2, opacity: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 1 }}
                      className="absolute inset-0 rounded-xl"
                      style={{
                        background: `radial-gradient(circle, ${primaryColor}30, transparent)`,
                      }}
                    />
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Shimmer animation keyframes */}
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
