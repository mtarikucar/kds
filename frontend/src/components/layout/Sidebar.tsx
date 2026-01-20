import { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  ShoppingCart,
  ChefHat,
  UtensilsCrossed,
  Table,
  BarChart3,
  Settings,
  Users,
  QrCode,
  UserCircle,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  X,
} from 'lucide-react';
import { UserRole, PlanFeatures } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { RTL_LANGUAGES } from '../../i18n/config';
import Tooltip from '../ui/Tooltip';
import { cn } from '../../lib/utils';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar = ({ isOpen, onClose }: SidebarProps) => {
  const { t, i18n } = useTranslation('common');
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const { isSidebarCollapsed, toggleSidebar } = useUiStore();
  const { hasFeature } = useSubscription();
  const [settingsOpen, setSettingsOpen] = useState(
    location.pathname.startsWith('/admin/settings')
  );
  const isRTL = RTL_LANGUAGES.includes(i18n.language);

  const handleNavClick = () => {
    // Close sidebar on mobile when navigating
    if (window.innerWidth < 768) {
      onClose();
    }
  };

  const navItems = [
    {
      to: '/dashboard',
      icon: LayoutDashboard,
      label: t('navigation.dashboard'),
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN, UserRole.COURIER],
    },
    {
      to: '/pos',
      icon: ShoppingCart,
      label: t('navigation.pos'),
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER],
    },
    {
      to: '/kitchen',
      icon: ChefHat,
      label: t('navigation.kitchen'),
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN],
    },
    {
      to: '/admin/menu',
      icon: UtensilsCrossed,
      label: t('navigation.menu'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/tables',
      icon: Table,
      label: t('navigation.tables'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/users',
      icon: Users,
      label: t('navigation.users'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/customers',
      icon: UserCircle,
      label: t('navigation.customers'),
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER],
    },
    {
      to: '/admin/qr-codes',
      icon: QrCode,
      label: t('navigation.qrCodes'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/reports',
      icon: BarChart3,
      label: t('navigation.reports'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
      requiredFeature: 'advancedReports' as keyof PlanFeatures,
    },
  ];

  const settingsItems = [
    {
      to: '/admin/settings/subscription',
      label: t('navigation.subscription'),
    },
    {
      to: '/admin/settings/pos',
      label: t('settings:pos'),
    },
    {
      to: '/admin/settings/integrations',
      label: t('settings:integrationsLabel'),
      requiredFeature: 'apiAccess' as keyof PlanFeatures,
    },
  ];

  // Filter nav items based on role and subscription features
  const filteredNavItems = navItems.filter((item) => {
    // Check role first
    if (!user?.role || !item.roles.includes(user.role as UserRole)) {
      return false;
    }
    // Check feature requirement if specified
    if (item.requiredFeature && !hasFeature(item.requiredFeature)) {
      return false;
    }
    return true;
  });

  // Filter settings items based on subscription features
  const filteredSettingsItems = settingsItems.filter((item) => {
    if (item.requiredFeature && !hasFeature(item.requiredFeature)) {
      return false;
    }
    return true;
  });

  // Keyboard navigation
  const navRefs = useRef<(HTMLAnchorElement | HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen && window.innerWidth < 768) return;

      const currentIndex = navRefs.current.findIndex(
        (ref) => ref === document.activeElement
      );

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = Math.min(currentIndex + 1, navRefs.current.length - 1);
        navRefs.current[nextIndex]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = Math.max(currentIndex - 1, 0);
        navRefs.current[prevIndex]?.focus();
      }
    };

    if (isOpen || window.innerWidth >= 768) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  return (
    <aside
      className={`fixed md:static inset-y-0 z-50 ${isRTL ? 'right-0' : 'left-0'} bg-neutral-900 text-white min-h-screen transform transition-all duration-300 ease-in-out shadow-xl ${
        isOpen
          ? 'translate-x-0'
          : isRTL
            ? 'translate-x-full md:translate-x-0'
            : '-translate-x-full md:translate-x-0'
      } ${isSidebarCollapsed ? 'md:w-16' : 'md:w-64'} w-64`}
    >
      <div className="p-6 flex items-center justify-between border-b border-neutral-800">
        {!isSidebarCollapsed && (
          <h2 className="text-xl font-bold font-heading bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
            HummyTummy
          </h2>
        )}
        {isSidebarCollapsed && <div className="w-full" />}
        {/* Mobile close button */}
        <button
          onClick={onClose}
          className="md:hidden text-neutral-400 hover:text-white transition-colors duration-200"
          aria-label="Close menu"
        >
          <X className="h-6 w-6" />
        </button>
        {/* Desktop collapse toggle button */}
        <button
          onClick={toggleSidebar}
          className="hidden md:block text-neutral-400 hover:text-white transition-colors duration-200 hover:bg-neutral-800 p-1.5 rounded-lg"
          aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isSidebarCollapsed ? t('navigation.expandSidebar') : t('navigation.collapseSidebar')}
        >
          {isSidebarCollapsed
            ? (isRTL ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />)
            : (isRTL ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />)
          }
        </button>
      </div>

      <nav className="px-3">
        {filteredNavItems.map((item, index) => {
          const navItem = (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={handleNavClick}
              ref={(el) => {
                navRefs.current[index] = el;
              }}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-all duration-150 ${
                  isActive
                    ? 'bg-primary-500 text-primary-foreground shadow-md scale-[1.02]'
                    : 'text-neutral-300 hover:bg-neutral-800 hover:text-white hover:scale-[1.01]'
                } ${isSidebarCollapsed ? 'justify-center' : ''} focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-neutral-900`
              }
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {!isSidebarCollapsed && <span className="font-medium">{item.label}</span>}
            </NavLink>
          );

          return isSidebarCollapsed ? (
            <Tooltip key={item.to} content={item.label} position={isRTL ? 'left' : 'right'} delay={300}>
              {navItem}
            </Tooltip>
          ) : (
            navItem
          );
        })}

        {/* Settings Dropdown */}
        {(user?.role === UserRole.ADMIN || user?.role === UserRole.MANAGER) && (
          <div className="mt-1">
            {(() => {
              const settingsButton = (
                <button
                  ref={(el) => {
                    navRefs.current[filteredNavItems.length] = el;
                  }}
                  onClick={() => !isSidebarCollapsed && setSettingsOpen(!settingsOpen)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ${
                    location.pathname.startsWith('/admin/settings')
                      ? 'bg-primary-500 text-primary-foreground shadow-md scale-[1.02]'
                      : 'text-neutral-300 hover:bg-neutral-800 hover:text-white hover:scale-[1.01]'
                  } ${isSidebarCollapsed ? 'justify-center' : ''} focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-neutral-900`}
                >
                  <Settings className="h-5 w-5 flex-shrink-0" />
                  {!isSidebarCollapsed && (
                    <>
                      <span className={`font-medium flex-1 ${isRTL ? 'text-right' : 'text-left'}`}>{t('navigation.settings')}</span>
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 transition-transform duration-150',
                          settingsOpen && 'rotate-180'
                        )}
                      />
                    </>
                  )}
                </button>
              );

              return isSidebarCollapsed ? (
                <Tooltip content={t('navigation.settings')} position={isRTL ? 'left' : 'right'} delay={300}>
                  {settingsButton}
                </Tooltip>
              ) : (
                settingsButton
              );
            })()}

            {!isSidebarCollapsed && (
              <div
                className={cn(
                  `${isRTL ? 'mr-4' : 'ml-4'} mt-1 space-y-1 overflow-hidden transition-all duration-200`,
                  settingsOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                )}
              >
                {filteredSettingsItems.map((item, index) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={handleNavClick}
                    ref={(el) => {
                      navRefs.current[filteredNavItems.length + 1 + index] = el;
                    }}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-150 ${
                        isActive
                          ? 'bg-primary-400 text-primary-foreground shadow-sm scale-[1.01]'
                          : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
                      } focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-neutral-900`
                    }
                  >
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>
    </aside>
  );
};

export default Sidebar;
