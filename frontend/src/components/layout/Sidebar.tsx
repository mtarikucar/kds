import { useState } from 'react';
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
import { UserRole } from '../../types';
import { useAuthStore } from '../../store/authStore';
import { useUiStore } from '../../store/uiStore';
import { RTL_LANGUAGES } from '../../i18n/config';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar = ({ isOpen, onClose }: SidebarProps) => {
  const { t, i18n } = useTranslation('common');
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const { isSidebarCollapsed, toggleSidebar } = useUiStore();
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
    },
  ];

  const filteredNavItems = navItems.filter((item) =>
    user?.role ? item.roles.includes(user.role) : false
  );

  return (
    <aside
      className={`fixed md:static inset-y-0 z-50 ${isRTL ? 'right-0' : 'left-0'} bg-gray-900 text-white min-h-screen transform transition-all duration-300 ease-in-out ${
        isOpen
          ? 'translate-x-0'
          : isRTL
            ? 'translate-x-full md:translate-x-0'
            : '-translate-x-full md:translate-x-0'
      } ${isSidebarCollapsed ? 'md:w-16' : 'md:w-64'} w-64`}
    >
      <div className="p-6 flex items-center justify-between">
        {!isSidebarCollapsed && <h2 className="text-xl font-bold">HummyTummy</h2>}
        {isSidebarCollapsed && <div className="w-full" />}
        {/* Mobile close button */}
        <button
          onClick={onClose}
          className="md:hidden text-gray-400 hover:text-white"
          aria-label="Close menu"
        >
          <X className="h-6 w-6" />
        </button>
        {/* Desktop collapse toggle button */}
        <button
          onClick={toggleSidebar}
          className="hidden md:block text-gray-400 hover:text-white"
          aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isSidebarCollapsed ? t('navigation.expandSidebar') : t('navigation.collapseSidebar')}
        >
          {isSidebarCollapsed
            ? (isRTL ? <ChevronLeft className="h-6 w-6" /> : <ChevronRight className="h-6 w-6" />)
            : (isRTL ? <ChevronRight className="h-6 w-6" /> : <ChevronLeft className="h-6 w-6" />)
          }
        </button>
      </div>

      <nav className="px-3">
        {filteredNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={handleNavClick}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              } ${isSidebarCollapsed ? 'justify-center' : ''}`
            }
            title={isSidebarCollapsed ? item.label : undefined}
          >
            <item.icon className="h-5 w-5" />
            {!isSidebarCollapsed && <span className="font-medium">{item.label}</span>}
          </NavLink>
        ))}

        {/* Settings Dropdown */}
        {(user?.role === UserRole.ADMIN || user?.role === UserRole.MANAGER) && (
          <div className="mt-1">
            <button
              onClick={() => !isSidebarCollapsed && setSettingsOpen(!settingsOpen)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                location.pathname.startsWith('/admin/settings')
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              } ${isSidebarCollapsed ? 'justify-center' : ''}`}
              title={isSidebarCollapsed ? t('navigation.settings') : undefined}
            >
              <Settings className="h-5 w-5" />
              {!isSidebarCollapsed && (
                <>
                  <span className={`font-medium flex-1 ${isRTL ? 'text-right' : 'text-left'}`}>{t('navigation.settings')}</span>
                  {settingsOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    isRTL ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                  )}
                </>
              )}
            </button>

            {!isSidebarCollapsed && settingsOpen && (
              <div className={`${isRTL ? 'mr-4' : 'ml-4'} mt-1 space-y-1`}>
                {settingsItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={handleNavClick}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-blue-500 text-white'
                          : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                      }`
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
