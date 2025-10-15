import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  ChefHat,
  UtensilsCrossed,
  Table,
  BarChart3,
  CreditCard,
  Users,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

const Sidebar = () => {
  const user = useAuthStore((state) => state.user);

  const navItems = [
    {
      to: '/dashboard',
      icon: LayoutDashboard,
      label: 'Dashboard',
      roles: ['ADMIN', 'MANAGER', 'WAITER', 'KITCHEN', 'COURIER'],
    },
    {
      to: '/pos',
      icon: ShoppingCart,
      label: 'POS',
      roles: ['ADMIN', 'MANAGER', 'WAITER'],
    },
    {
      to: '/kitchen',
      icon: ChefHat,
      label: 'Kitchen Display',
      roles: ['ADMIN', 'MANAGER', 'KITCHEN'],
    },
    {
      to: '/admin/menu',
      icon: UtensilsCrossed,
      label: 'Menu Management',
      roles: ['ADMIN', 'MANAGER'],
    },
    {
      to: '/admin/tables',
      icon: Table,
      label: 'Table Management',
      roles: ['ADMIN', 'MANAGER'],
    },
    {
      to: '/admin/users',
      icon: Users,
      label: 'User Management',
      roles: ['ADMIN', 'MANAGER'],
    },
    {
      to: '/admin/reports',
      icon: BarChart3,
      label: 'Reports',
      roles: ['ADMIN', 'MANAGER'],
    },
    {
      to: '/subscription/manage',
      icon: CreditCard,
      label: 'Subscription',
      roles: ['ADMIN', 'MANAGER'],
    },
  ];

  const filteredNavItems = navItems.filter((item) =>
    user?.role ? item.roles.includes(user.role) : false
  );

  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen">
      <div className="p-6">
        <h2 className="text-xl font-bold">Restaurant POS</h2>
      </div>

      <nav className="px-3">
        {filteredNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
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
      </nav>
    </aside>
  );
};

export default Sidebar;
