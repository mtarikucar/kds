import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
// import { format } from 'date-fns';
import { useOrders } from '../features/orders/ordersApi';
import { useTables } from '../features/tables/tablesApi';
import { useAuthStore } from '../store/authStore';
import { useCurrency } from '../hooks/useCurrency';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Spinner from '../components/ui/Spinner';
import { formatCurrency, formatTimeAgo } from '../lib/utils';
import {
  ShoppingCart,
  Table as TableIcon,
  UtensilsCrossed,
  TrendingUp,
  Clock,
  LucideIcon,
} from 'lucide-react';
import { OrderStatus, TableStatus, UserRole } from '../types';

interface QuickAction {
  to: string;
  icon: LucideIcon;
  label: string;
  bgColor: string;
  hoverColor: string;
  iconColor: string;
  textColor: string;
  roles: UserRole[];
}

const DashboardPage = () => {
  const { t } = useTranslation('common');
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: tables, isLoading: tablesLoading } = useTables();
  const user = useAuthStore((state) => state.user);
  const userRole = user?.role as UserRole;
  const currency = useCurrency();

  // Define quick actions with role-based access (using static Tailwind classes)
  const quickActions: QuickAction[] = [
    {
      to: '/pos',
      icon: ShoppingCart,
      label: 'dashboard.newOrder',
      bgColor: 'bg-blue-50',
      hoverColor: 'hover:bg-blue-100',
      iconColor: 'text-blue-600',
      textColor: 'text-blue-900',
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.WAITER],
    },
    {
      to: '/kitchen',
      icon: UtensilsCrossed,
      label: 'dashboard.kitchenDisplay',
      bgColor: 'bg-green-50',
      hoverColor: 'hover:bg-green-100',
      iconColor: 'text-green-600',
      textColor: 'text-green-900',
      roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.KITCHEN],
    },
    {
      to: '/admin/menu',
      icon: UtensilsCrossed,
      label: 'dashboard.manageMenu',
      bgColor: 'bg-purple-50',
      hoverColor: 'hover:bg-purple-100',
      iconColor: 'text-purple-600',
      textColor: 'text-purple-900',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
    {
      to: '/admin/tables',
      icon: TableIcon,
      label: 'dashboard.manageTables',
      bgColor: 'bg-orange-50',
      hoverColor: 'hover:bg-orange-100',
      iconColor: 'text-orange-600',
      textColor: 'text-orange-900',
      roles: [UserRole.ADMIN, UserRole.MANAGER],
    },
  ];

  // Filter quick actions based on user role
  const filteredQuickActions = quickActions.filter(
    (action) => userRole && action.roles.includes(userRole)
  );

  const todayOrders = orders?.filter((order) => {
    const orderDate = new Date(order.createdAt);
    const today = new Date();
    return orderDate.toDateString() === today.toDateString();
  }) || [];

  const todaySales = todayOrders.reduce((sum, order) => sum + Number(order.finalAmount || 0), 0);

  const activeOrders = orders?.filter(
    (order) =>
      order.status !== OrderStatus.SERVED && order.status !== OrderStatus.CANCELLED
  ) || [];

  const availableTables = tables?.filter(
    (table) => table.status === TableStatus.AVAILABLE
  ) || [];

  const recentOrders = orders?.slice(0, 5) || [];

  const StatCard = ({
    title,
    value,
    icon: Icon,
    color,
    link,
  }: {
    title: string;
    value: string | number;
    icon: any;
    color: string;
    link?: string;
  }) => {
    const CardWrapper = link ? Link : 'div';
    return (
      <CardWrapper to={link || ''}>
        <Card className={link ? 'hover:shadow-lg transition-shadow cursor-pointer' : ''}>
          <CardContent className="pt-4 md:pt-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs md:text-sm text-gray-600 mb-1">{title}</p>
                <p className="text-2xl md:text-3xl font-bold truncate">{value}</p>
              </div>
              <div className={`p-3 md:p-4 rounded-full ${color} flex-shrink-0`}>
                <Icon className="h-6 w-6 md:h-8 md:w-8 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
      </CardWrapper>
    );
  };

  const getStatusVariant = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.PENDING:
        return 'warning';
      case OrderStatus.PREPARING:
        return 'primary';
      case OrderStatus.READY:
        return 'success';
      case OrderStatus.SERVED:
        return 'default';
      default:
        return 'danger';
    }
  };

  if (ordersLoading || tablesLoading) {
    return <Spinner />;
  }

  return (
    <div>
      <div className="mb-4 md:mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t('dashboard.title')}</h1>
        <p className="text-sm md:text-base text-gray-600">{t('dashboard.welcome')}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 lg:gap-6 mb-4 md:mb-6">
        <StatCard
          title={t('dashboard.todaysSales')}
          value={formatCurrency(todaySales, currency)}
          icon={TrendingUp}
          color="bg-green-500"
          link="/admin/reports"
        />
        <StatCard
          title={t('dashboard.todaysOrders')}
          value={todayOrders.length}
          icon={ShoppingCart}
          color="bg-blue-500"
          link="/pos"
        />
        <StatCard
          title={t('dashboard.activeOrders')}
          value={activeOrders.length}
          icon={Clock}
          color="bg-orange-500"
          link="/kitchen"
        />
        <StatCard
          title={t('dashboard.availableTables')}
          value={`${availableTables.length}/${tables?.length || 0}`}
          icon={TableIcon}
          color="bg-purple-500"
          link="/admin/tables"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Recent Orders */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('dashboard.recentOrders')}</CardTitle>
            <Link
              to="/pos"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {t('dashboard.viewAll')}
            </Link>
          </CardHeader>
          <CardContent>
            {recentOrders.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>{t('dashboard.noOrders')}</p>
              </div>
            ) : (
              <div className="space-y-2 md:space-y-3">
                {recentOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between p-2 md:p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm md:text-base font-semibold truncate">#{order.orderNumber}</p>
                      <p className="text-xs md:text-sm text-gray-600 truncate">
                        {t('pos:tableLabel')} {order.table?.number} • {formatTimeAgo(order.createdAt)}
                      </p>
                      <p className="text-xs md:text-sm text-gray-600">
                        {order.items?.length || 0} {t('dashboard.items')}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <Badge variant={getStatusVariant(order.status)}>
                        {order.status}
                      </Badge>
                      <p className="text-xs md:text-sm font-bold text-gray-900 mt-1">
                        {formatCurrency(Number(order.finalAmount), currency)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        {filteredQuickActions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.quickActions')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 md:gap-4">
                {filteredQuickActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Link key={action.to} to={action.to}>
                      <div className={`p-4 md:p-6 ${action.bgColor} rounded-lg ${action.hoverColor} transition-colors text-center cursor-pointer`}>
                        <Icon className={`h-6 w-6 md:h-8 md:w-8 ${action.iconColor} mx-auto mb-2`} />
                        <p className={`text-sm md:text-base font-semibold ${action.textColor}`}>{t(action.label)}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Active Orders Summary */}
      {activeOrders.length > 0 && (
        <Card className="mt-4 md:mt-6">
          <CardHeader>
            <CardTitle>{t('dashboard.activeOrdersSummary')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 md:gap-4">
              <div className="p-4 bg-yellow-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">{t('dashboard.pending')}</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {
                    activeOrders.filter((o) => o.status === OrderStatus.PENDING)
                      .length
                  }
                </p>
              </div>
              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">{t('dashboard.preparing')}</p>
                <p className="text-2xl font-bold text-blue-600">
                  {
                    activeOrders.filter((o) => o.status === OrderStatus.PREPARING)
                      .length
                  }
                </p>
              </div>
              <div className="p-4 bg-green-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">{t('dashboard.ready')}</p>
                <p className="text-2xl font-bold text-green-600">
                  {
                    activeOrders.filter((o) => o.status === OrderStatus.READY)
                      .length
                  }
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default DashboardPage;
