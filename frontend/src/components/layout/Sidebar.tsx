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
} from 'lucide-react';
import { UserRole, PlanFeatures } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';
import { useSubscription } from '../../contexts/SubscriptionContext';
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
  const isRTL = isRTLProp ?? RTL_LANGUAGES.includes(i18n.language);

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
      className={`fixed md:static inset-y-0 z-50 ${isRTL ? 'right-0 md:order-2' : 'left-0'} bg-slate-900 text-white min-h-screen transform transition-all duration-300 ease-in-out ${
        isOpen
          ? 'translate-x-0'
          : isRTL
            ? 'max-md:translate-x-full'
            : 'max-md:-translate-x-full'
      } ${isSidebarCollapsed ? 'md:w-16' : 'md:w-64'} w-64`}
    >
      {/* Header */}
      <div className="px-5 py-6 flex items-center justify-between border-b border-slate-800/50">
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
      <nav className="px-3 py-4">
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
    </aside>
  );
};

export default Sidebar;
