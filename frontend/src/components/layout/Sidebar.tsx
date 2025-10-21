import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
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
  X,
} from 'lucide-react';
import { UserRole } from '../../types';
import { useAuthStore } from '../../store/authStore';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar = ({ isOpen, onClose }: SidebarProps) => {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(
    location.pathname.startsWith('/admin/settings')
  );

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
      label: 'Dashboard',
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER, UserRole.KITCHEN, UserRole.COURIER],
    },
    {
      to: '/pos',
      icon: ShoppingCart,
      label: 'POS',
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER],
    },
    {
      to: '/kitchen',
      icon: ChefHat,
      label: 'Kitchen Display',
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN],
    },
    {
      to: '/admin/menu',
      icon: UtensilsCrossed,
      label: 'Menu Management',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/tables',
      icon: Table,
      label: 'Table Management',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/users',
      icon: Users,
      label: 'User Management',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/customers',
      icon: UserCircle,
      label: 'Customers',
      roles: ['ADMIN', 'MANAGER', 'WAITER'],
    },
    {
      to: '/admin/qr-codes',
      icon: QrCode,
      label: 'QR Codes',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/reports',
      icon: BarChart3,
      label: 'Reports',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
  ];

  const settingsItems = [
    {
      to: '/admin/settings/subscription',
      label: 'Subscription',
    },
    {
      to: '/admin/settings/pos',
      label: 'POS Settings',
    },
    {
      to: '/admin/settings/integrations',
      label: 'Integrations',
    },
  ];

  const filteredNavItems = navItems.filter((item) =>
    user?.role ? item.roles.includes(user.role) : false
  );

  return (
    <aside
      className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-gray-900 text-white min-h-screen transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}
    >
      <div className="p-6 flex items-center justify-between">
        <h2 className="text-xl font-bold">Restaurant POS</h2>
        {/* Close button for mobile */}
        <button
          onClick={onClose}
          className="md:hidden text-gray-400 hover:text-white"
          aria-label="Close menu"
        >
          <X className="h-6 w-6" />
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
              }`
            }
          >
            <item.icon className="h-5 w-5" />
            <span className="font-medium">{item.label}</span>
          </NavLink>
        ))}

        {/* Settings Dropdown */}
        {(user?.role === UserRole.ADMIN || user?.role === UserRole.MANAGER) && (
          <div className="mt-1">
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                location.pathname.startsWith('/admin/settings')
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Settings className="h-5 w-5" />
              <span className="font-medium flex-1 text-left">Settings</span>
              {settingsOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            {settingsOpen && (
              <div className="ml-4 mt-1 space-y-1">
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
