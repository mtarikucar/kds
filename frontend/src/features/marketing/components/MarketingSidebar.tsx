import { NavLink } from 'react-router-dom';
import {
  HomeIcon,
  UserGroupIcon,
  ClipboardDocumentListIcon,
  CalendarIcon,
  DocumentTextIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  UsersIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline';
import { useMarketingAuthStore } from '../../../store/marketingAuthStore';

const navItems = [
  { path: '/marketing/dashboard', label: 'Dashboard', icon: HomeIcon },
  { path: '/marketing/leads', label: 'Leads', icon: UserGroupIcon },
  { path: '/marketing/tasks', label: 'Tasks', icon: ClipboardDocumentListIcon },
  { path: '/marketing/calendar', label: 'Calendar', icon: CalendarIcon },
  { path: '/marketing/offers', label: 'Offers', icon: DocumentTextIcon },
  { path: '/marketing/reports', label: 'Reports', icon: ChartBarIcon },
  { path: '/marketing/commissions', label: 'Commissions', icon: CurrencyDollarIcon },
];

const managerOnlyItems = [
  { path: '/marketing/users', label: 'Sales Team', icon: UsersIcon },
];

export default function MarketingSidebar() {
  const { user, logout } = useMarketingAuthStore();
  const isManager = user?.role === 'SALES_MANAGER';

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
      isActive
        ? 'bg-indigo-50 text-indigo-700'
        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`;

  return (
    <aside className="flex flex-col w-64 bg-white border-r border-gray-200 min-h-screen">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 py-5 border-b border-gray-200">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-sm">M</span>
        </div>
        <span className="font-semibold text-gray-900">Marketing Panel</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink key={item.path} to={item.path} className={linkClass}>
            <item.icon className="w-5 h-5" />
            {item.label}
          </NavLink>
        ))}

        {isManager && (
          <>
            <div className="pt-4 pb-2 px-4">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Management
              </span>
            </div>
            {managerOnlyItems.map((item) => (
              <NavLink key={item.path} to={item.path} className={linkClass}>
                <item.icon className="w-5 h-5" />
                {item.label}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User info & logout */}
      <div className="border-t border-gray-200 px-4 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
            <span className="text-indigo-700 font-medium text-sm">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-gray-500 truncate">
              {user?.role === 'SALES_MANAGER' ? 'Sales Manager' : 'Sales Rep'}
            </p>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <ArrowRightOnRectangleIcon className="w-4 h-4" />
          Logout
        </button>
      </div>
    </aside>
  );
}
