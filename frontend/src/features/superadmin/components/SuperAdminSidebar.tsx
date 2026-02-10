import { NavLink } from 'react-router-dom';
import { Fragment } from 'react';
import { Menu, Transition } from '@headlessui/react';
import {
  LayoutDashboard,
  Building2,
  Users,
  CreditCard,
  FileText,
  Settings,
  Layers,
  LogOut,
  ChevronDown,
  Terminal,
} from 'lucide-react';
import { useSuperAdminAuthStore } from '../../../store/superAdminAuthStore';
import { useSuperAdminLogout } from '../api/superAdminApi';

const navigation = [
  { name: 'Dashboard', href: '/superadmin/dashboard', icon: LayoutDashboard },
  { name: 'Tenants', href: '/superadmin/tenants', icon: Building2 },
  { name: 'Users', href: '/superadmin/users', icon: Users },
  { name: 'Plans', href: '/superadmin/plans', icon: Layers },
  { name: 'Subscriptions', href: '/superadmin/subscriptions', icon: CreditCard },
  { name: 'Audit Logs', href: '/superadmin/audit-logs', icon: FileText },
  { name: 'Terminal', href: '/superadmin/terminal', icon: Terminal },
  { name: 'Settings', href: '/superadmin/settings', icon: Settings },
];

export default function SuperAdminSidebar() {
  const { superAdmin } = useSuperAdminAuthStore();
  const logoutMutation = useSuperAdminLogout();

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <aside className="w-64 bg-white border-r border-zinc-200 flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-zinc-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center">
            <span className="text-white text-sm font-semibold">K</span>
          </div>
          <span className="text-zinc-900 font-semibold tracking-tight">KDS Admin</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navigation.map((item) => (
          <NavLink
            key={item.name}
            to={item.href}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                isActive
                  ? 'bg-zinc-100 text-zinc-900'
                  : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
              }`
            }
          >
            <item.icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
            {item.name}
          </NavLink>
        ))}
      </nav>

      {/* User Menu */}
      <div className="p-3 border-t border-zinc-100">
        <Menu as="div" className="relative">
          <Menu.Button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-zinc-50 transition-colors">
            <div className="w-8 h-8 bg-zinc-200 rounded-full flex items-center justify-center">
              <span className="text-zinc-600 text-xs font-medium">
                {superAdmin?.firstName?.[0]}{superAdmin?.lastName?.[0]}
              </span>
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium text-zinc-900 truncate">
                {superAdmin?.firstName} {superAdmin?.lastName}
              </p>
              <p className="text-xs text-zinc-500 truncate">{superAdmin?.email}</p>
            </div>
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          </Menu.Button>

          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <Menu.Items className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-zinc-200 rounded-lg shadow-lg py-1 focus:outline-none">
              <Menu.Item>
                {({ active }) => (
                  <button
                    onClick={handleLogout}
                    className={`${
                      active ? 'bg-zinc-50' : ''
                    } flex w-full items-center gap-2 px-3 py-2 text-sm text-zinc-700`}
                  >
                    <LogOut className="w-4 h-4" />
                    Sign out
                  </button>
                )}
              </Menu.Item>
            </Menu.Items>
          </Transition>
        </Menu>
      </div>
    </aside>
  );
}
