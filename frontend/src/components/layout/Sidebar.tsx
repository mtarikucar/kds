import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  ShoppingCart,
  ChefHat,
  UtensilsCrossed,
  Table,
  BarChart3,
  Activity,
  Settings,
  Users,
  QrCode,
  UserCircle,
  ChevronRight,
  ChevronLeft,
  X,
  Code,
  CalendarCheck,
  UserCog,
  Package,
  Receipt,
  LogOut,
  User,
} from 'lucide-react';
import { UserRole, PlanFeatures } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useLogout } from '../../features/auth/authApi';
import { RTL_LANGUAGES } from '../../i18n/config';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isRTL?: boolean;
}

const Sidebar = ({ isOpen, onClose, isRTL: isRTLProp }: SidebarProps) => {
  const { t, i18n } = useTranslation('common');
  const user = useAuthStore((state) => state.user);
  const { isSidebarCollapsed, toggleSidebar } = useUiStore();
  const { hasFeature } = useSubscription();
  const { mutate: logout, isPending: isLoggingOut } = useLogout();
  const isRTL = isRTLProp ?? RTL_LANGUAGES.includes(i18n.language);

  const handleLogout = () => {
    if (window.innerWidth < 768) {
      onClose();
    }
    logout();
  };

  const handleNavClick = () => {
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
      to: '/admin/reservations',
      icon: CalendarCheck,
      label: t('navigation.reservations'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
      requiredFeature: 'reservationSystem' as keyof PlanFeatures,
    },
    {
      to: '/admin/personnel',
      icon: UserCog,
      label: t('navigation.personnel'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
      requiredFeature: 'personnelManagement' as keyof PlanFeatures,
    },
    {
      to: '/admin/stock',
      icon: Package,
      label: t('navigation.stock'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
      requiredFeature: 'inventoryTracking' as keyof PlanFeatures,
    },
    {
      to: '/admin/reports',
      icon: BarChart3,
      label: t('navigation.reports'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
      requiredFeature: 'advancedReports' as keyof PlanFeatures,
    },
    {
      to: '/admin/invoices',
      icon: Receipt,
      label: t('navigation.invoices'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/analytics',
      icon: Activity,
      label: t('navigation.analytics'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/settings',
      icon: Settings,
      label: t('navigation.settings'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    // HummyTummy Phase 3-12 additions. Ordered by typical use:
    // operational (devices, branches, health) before commercial
    // (marketplace, store).
    {
      to: '/admin/devices',
      icon: Activity,
      label: t('navigation.devices'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/branches',
      icon: Receipt,
      label: t('navigation.branches'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/health',
      icon: Activity,
      label: t('navigation.health'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/marketplace',
      icon: Package,
      label: t('navigation.marketplace'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/store',
      icon: Package,
      label: t('navigation.store'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/hardware-orders',
      icon: Package,
      label: t('navigation.hardwareOrders', { defaultValue: 'Donanım Siparişlerim' }),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    // Operasyonel ek sayfalar — admin için.
    {
      to: '/admin/bridges',
      icon: Activity,
      label: t('navigation.bridges'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/webhooks',
      icon: Activity,
      label: t('navigation.webhooks'),
      roles: [UserRole.ADMIN],
    },
    {
      to: '/admin/fiscal-recovery',
      icon: Receipt,
      label: t('navigation.fiscalRecovery'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/caller-feed',
      icon: Activity,
      label: t('navigation.callerFeed'),
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
  ];

  const filteredNavItems = navItems.filter((item) => {
    if (!user?.role || !item.roles.includes(user.role as UserRole)) {
      return false;
    }
    if (item.requiredFeature && !hasFeature(item.requiredFeature)) {
      return false;
    }
    return true;
  });

  return (
    <aside
      className={`fixed md:static inset-y-0 z-50 ${isRTL ? 'right-0 md:order-2' : 'left-0'} bg-slate-900 text-white h-screen md:h-auto md:min-h-screen flex flex-col transform transition-all duration-300 ease-in-out ${
        isOpen
          ? 'translate-x-0'
          : isRTL
            ? 'max-md:translate-x-full'
            : 'max-md:-translate-x-full'
      } ${isSidebarCollapsed ? 'md:w-16' : 'md:w-64'} w-64`}
    >
      {/* Header */}
      <div className="px-5 py-6 flex items-center justify-between border-b border-slate-800/50 flex-shrink-0">
        {!isSidebarCollapsed && (
          <h2 className="text-xl font-heading font-bold bg-gradient-to-r from-primary-400 to-primary-300 bg-clip-text text-transparent">
            HummyTummy
          </h2>
        )}
        {isSidebarCollapsed && <div className="w-full" />}

        {/* Mobile close button */}
        <button
          onClick={onClose}
          className="md:hidden text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-all"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Desktop collapse toggle button */}
        <button
          onClick={toggleSidebar}
          className="hidden md:flex items-center justify-center w-8 h-8 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
          aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isSidebarCollapsed ? t('navigation.expandSidebar') : t('navigation.collapseSidebar')}
        >
          {isSidebarCollapsed
            ? (isRTL ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />)
            : (isRTL ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />)
          }
        </button>
      </div>

      {/* Navigation */}
      <nav className="px-3 py-4 flex-1 overflow-y-auto">
        <div className="space-y-1">
          {filteredNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={handleNavClick}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ${
                  isActive
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                } ${isSidebarCollapsed ? 'md:justify-center' : ''}`
              }
              title={isSidebarCollapsed ? item.label : undefined}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              <span className={`text-sm ${isSidebarCollapsed ? 'md:hidden' : ''}`}>{item.label}</span>
            </NavLink>
          ))}
        </div>

        {/* Development section - only visible in dev mode for ADMIN */}
        {import.meta.env.DEV && user?.role === UserRole.ADMIN && (
          <div className="mt-6 pt-4 border-t border-slate-800/50">
            {!isSidebarCollapsed && (
              <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
                Development
              </p>
            )}
            <NavLink
              to="/dev/floor-plan"
              onClick={handleNavClick}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ${
                  isActive
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                } ${isSidebarCollapsed ? 'md:justify-center' : ''}`
              }
              title={isSidebarCollapsed ? 'Floor Plan 3D' : undefined}
            >
              <Code className="h-5 w-5 flex-shrink-0" />
              <span className={`text-sm ${isSidebarCollapsed ? 'md:hidden' : ''}`}>Floor Plan 3D</span>
            </NavLink>
          </div>
        )}
      </nav>

      {/* Footer: user info + logout. Always visible on mobile so users can
          sign out from the slide-in menu; on desktop it complements the
          header's logout button. */}
      <div className="flex-shrink-0 border-t border-slate-800/50 px-3 py-3 space-y-1">
        <NavLink
          to="/profile"
          onClick={handleNavClick}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ${
              isActive
                ? 'bg-white/10 text-white font-medium'
                : 'text-slate-300 hover:bg-white/5 hover:text-white'
            } ${isSidebarCollapsed ? 'md:justify-center' : ''}`
          }
          title={isSidebarCollapsed ? `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() : undefined}
        >
          <div className="w-8 h-8 rounded-lg bg-white/10 ring-1 ring-white/10 flex items-center justify-center flex-shrink-0">
            <User className="h-4 w-4" />
          </div>
          <div className={`min-w-0 ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
            <p className="text-sm font-medium truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-slate-400 capitalize truncate">
              {user?.role?.replace('_', ' ')}
            </p>
          </div>
        </NavLink>

        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 text-slate-300 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-60 disabled:cursor-not-allowed ${
            isSidebarCollapsed ? 'md:justify-center' : ''
          }`}
          title={isSidebarCollapsed ? t('app.logout') : undefined}
          aria-label={t('app.logout')}
        >
          <LogOut className="h-5 w-5 flex-shrink-0" />
          <span className={`text-sm font-medium ${isSidebarCollapsed ? 'md:hidden' : ''}`}>
            {t('app.logout')}
          </span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
