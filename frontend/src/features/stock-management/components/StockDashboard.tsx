import { useTranslation } from 'react-i18next';
import { Package, AlertTriangle, Clock, DollarSign, TrendingDown, ShoppingCart } from 'lucide-react';
import { useStockDashboard } from '../stockManagementApi';

const StockDashboard = () => {
  const { t } = useTranslation('stock');
  const { data: dashboard, isLoading } = useStockDashboard();

  if (isLoading) return <div className="text-center py-12 text-gray-500">{t('common.loading')}</div>;
  if (!dashboard) return null;

  const stats = [
    { label: t('dashboard.totalItems'), value: dashboard.totalItems, icon: Package, color: 'bg-blue-100 text-blue-600' },
    { label: t('dashboard.activeItems'), value: dashboard.activeItems, icon: Package, color: 'bg-green-100 text-green-600' },
    { label: t('dashboard.lowStock'), value: dashboard.lowStockCount, icon: AlertTriangle, color: 'bg-red-100 text-red-600' },
    { label: t('dashboard.expiringSoon'), value: dashboard.expiringBatchCount, icon: Clock, color: 'bg-yellow-100 text-yellow-600' },
    { label: t('dashboard.pendingPOs'), value: dashboard.pendingPurchaseOrders, icon: ShoppingCart, color: 'bg-purple-100 text-purple-600' },
    { label: t('dashboard.wasteLast30Days'), value: dashboard.wasteLast30Days.count, icon: TrendingDown, color: 'bg-orange-100 text-orange-600' },
  ];

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${stat.color}`}>
                <stat.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                <p className="text-xs text-gray-500">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Low Stock Alerts */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            {t('dashboard.lowStock')}
          </h3>
          {dashboard.lowStockItems.length === 0 ? (
            <p className="text-sm text-gray-500">{t('dashboard.noAlerts')}</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {dashboard.lowStockItems.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between p-2 bg-red-50 rounded-lg">
                  <span className="text-sm font-medium text-gray-900">{item.name}</span>
                  <span className="text-sm text-red-600 font-semibold">
                    {Number(item.currentStock).toFixed(1)} / {Number(item.minStock).toFixed(1)} {item.unit}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Movements */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('dashboard.recentMovements')}</h3>
          {dashboard.recentMovements.length === 0 ? (
            <p className="text-sm text-gray-500">{t('common.noData')}</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {dashboard.recentMovements.map((movement) => (
                <div key={movement.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{movement.stockItem?.name}</span>
                    <p className="text-xs text-gray-500">{movement.notes}</p>
                  </div>
                  <span className={`text-sm font-semibold ${Number(movement.quantity) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {Number(movement.quantity) >= 0 ? '+' : ''}{Number(movement.quantity).toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Expiring Batches */}
      {dashboard.expiringBatches.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-yellow-500" />
            {t('dashboard.expiringSoon')}
          </h3>
          <div className="space-y-2">
            {dashboard.expiringBatches.map((batch) => (
              <div key={batch.id} className="flex items-center justify-between p-2 bg-yellow-50 rounded-lg">
                <span className="text-sm font-medium text-gray-900">{batch.stockItem?.name}</span>
                <div className="text-right">
                  <span className="text-sm text-gray-700">{Number(batch.quantity).toFixed(1)} {batch.stockItem?.unit}</span>
                  <p className="text-xs text-yellow-600">
                    {batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default StockDashboard;
