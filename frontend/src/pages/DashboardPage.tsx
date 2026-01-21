import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import {
  ShoppingCart,
  Table as TableIcon,
  UtensilsCrossed,
  LucideIcon,
  ChefHat,
  Users,
  UserCircle,
  QrCode,
  BarChart3,
  Settings,
  ArrowRight,
} from 'lucide-react';
import { UserRole } from '../types';

interface QuickAction {
  to: string;
  icon: LucideIcon;
  label: string;
  description: string;
  roles: UserRole[];
  isPrimary?: boolean;
}

const DashboardPage = () => {
  const { t } = useTranslation('common');
  const user = useAuthStore((state) => state.user);
  const userRole = user?.role as UserRole;

  // Define quick actions with role-based access
  const quickActions: QuickAction[] = [
    {
      to: '/pos',
      icon: ShoppingCart,
      label: 'navigation.pos',
      description: 'dashboard.posDescription',
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER],
      isPrimary: true,
    },
    {
      to: '/kitchen',
      icon: ChefHat,
      label: 'navigation.kitchen',
      description: 'dashboard.kitchenDescription',
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN],
    },
    {
      to: '/admin/menu',
      icon: UtensilsCrossed,
      label: 'navigation.menu',
      description: 'dashboard.menuDescription',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/tables',
      icon: TableIcon,
      label: 'navigation.tables',
      description: 'dashboard.tablesDescription',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/users',
      icon: Users,
      label: 'navigation.users',
      description: 'dashboard.usersDescription',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/customers',
      icon: UserCircle,
      label: 'navigation.customers',
      description: 'dashboard.customersDescription',
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER],
    },
    {
      to: '/admin/qr-codes',
      icon: QrCode,
      label: 'navigation.qrCodes',
      description: 'dashboard.qrCodesDescription',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/reports',
      icon: BarChart3,
      label: 'navigation.reports',
      description: 'dashboard.reportsDescription',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/settings/subscription',
      icon: Settings,
      label: 'navigation.settings',
      description: 'dashboard.settingsDescription',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
  ];

  // Filter quick actions based on user role
  const filteredQuickActions = quickActions.filter(
    (action) => userRole && action.roles.includes(userRole)
  );

  const primaryAction = filteredQuickActions.find((a) => a.isPrimary);
  const secondaryActions = filteredQuickActions.filter((a) => !a.isPrimary);

  return (
    <div className="h-[calc(100vh-10rem)] flex flex-col">
      {/* POS Hero Card */}
      {primaryAction && (
        <Link
          to={primaryAction.to}
          className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 mb-4 shadow-lg hover:shadow-xl transition-all duration-300 block flex-shrink-0"
          aria-label={t(primaryAction.label)}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 to-purple-600/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          <div className="relative flex items-center gap-4">
            <div className="p-3 bg-white/10 rounded-xl group-hover:bg-white/15 transition-colors">
              <primaryAction.icon className="h-8 w-8 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-white">
                {t(primaryAction.label)}
              </h2>
              <p className="text-slate-400 text-sm">
                {t(primaryAction.description)}
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-white group-hover:translate-x-1 transition-all flex-shrink-0" />
          </div>
        </Link>
      )}

      {/* Secondary Actions Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1 min-h-0">
        {secondaryActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.to}
              to={action.to}
              className="group flex flex-col justify-center p-4 bg-white rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all duration-200"
            >
              <div className="flex items-center gap-3 mb-1.5">
                <div className="p-2 bg-slate-100 rounded-lg group-hover:bg-slate-200 transition-colors">
                  <Icon className="h-5 w-5 text-slate-600" />
                </div>
              </div>
              <h3 className="font-medium text-slate-900 text-sm">
                {t(action.label)}
              </h3>
              <p className="text-slate-500 text-xs line-clamp-1">
                {t(action.description)}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default DashboardPage;
