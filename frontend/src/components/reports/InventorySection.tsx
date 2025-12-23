import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Spinner from '../ui/Spinner';
import { useInventoryReport } from '../../api/enhancedReportsApi';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { Package, AlertTriangle, XCircle, Wallet, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { format } from 'date-fns';

const InventorySection = () => {
  const { t } = useTranslation('reports');
  const formatCurrency = useFormatCurrency();
  const { data, isLoading, error } = useInventoryReport();

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-gray-500">{t('reports.noData')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">{t('inventoryReport.totalTrackedProducts')}</p>
                <p className="text-2xl font-bold">{data.totalTrackedProducts}</p>
              </div>
              <div className="p-3 rounded-full bg-blue-500">
                <Package className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">{t('inventoryReport.lowStockCount')}</p>
                <p className="text-2xl font-bold text-amber-600">{data.lowStockCount}</p>
              </div>
              <div className="p-3 rounded-full bg-amber-500">
                <AlertTriangle className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">{t('inventoryReport.outOfStockCount')}</p>
                <p className="text-2xl font-bold text-red-600">{data.outOfStockCount}</p>
              </div>
              <div className="p-3 rounded-full bg-red-500">
                <XCircle className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">{t('inventoryReport.totalStockValue')}</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(data.totalStockValue)}</p>
              </div>
              <div className="p-3 rounded-full bg-green-500">
                <Wallet className="h-6 w-6 text-white" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Low Stock Alerts */}
      {data.lowStockItems.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
              {t('inventoryReport.lowStock')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.lowStockItems.map((item) => (
                <div
                  key={item.productId}
                  className="p-3 bg-white rounded-lg border border-amber-200"
                >
                  <p className="font-medium">{item.productName}</p>
                  {item.categoryName && (
                    <p className="text-sm text-gray-500">{item.categoryName}</p>
                  )}
                  <p className="text-lg font-bold text-amber-600 mt-1">
                    {item.currentStock} units left
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Out of Stock */}
      {data.outOfStockItems.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-700">
              <XCircle className="h-5 w-5" />
              {t('inventoryReport.outOfStock')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.outOfStockItems.map((item) => (
                <div
                  key={item.productId}
                  className="p-3 bg-white rounded-lg border border-red-200"
                >
                  <p className="font-medium">{item.productName}</p>
                  {item.categoryName && (
                    <p className="text-sm text-gray-500">{item.categoryName}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stock Levels */}
      <Card>
        <CardHeader>
          <CardTitle>{t('inventoryReport.stockLevels')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.stockLevels.length === 0 ? (
            <p className="text-center text-gray-500 py-4">{t('reports.noData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4">Product</th>
                    <th className="text-left py-3 px-4">Category</th>
                    <th className="text-right py-3 px-4">Stock</th>
                    <th className="text-right py-3 px-4">Price</th>
                    <th className="text-right py-3 px-4">Value</th>
                    <th className="text-center py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stockLevels.map((item) => (
                    <tr key={item.productId} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium">{item.productName}</td>
                      <td className="py-3 px-4 text-gray-600">{item.categoryName || '-'}</td>
                      <td className="py-3 px-4 text-right">{item.currentStock}</td>
                      <td className="py-3 px-4 text-right">{formatCurrency(item.price)}</td>
                      <td className="py-3 px-4 text-right font-semibold text-green-600">
                        {formatCurrency(item.stockValue)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {item.isOutOfStock ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            Out of Stock
                          </span>
                        ) : item.isLowStock ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            Low Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            In Stock
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Movements */}
      <Card>
        <CardHeader>
          <CardTitle>{t('inventoryReport.recentMovements')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentMovements.length === 0 ? (
            <p className="text-center text-gray-500 py-4">{t('reports.noData')}</p>
          ) : (
            <div className="space-y-3">
              {data.recentMovements.map((movement) => (
                <div
                  key={movement.id}
                  className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg"
                >
                  <div
                    className={`p-2 rounded-full ${
                      movement.type === 'IN'
                        ? 'bg-green-100 text-green-600'
                        : movement.type === 'OUT'
                        ? 'bg-red-100 text-red-600'
                        : 'bg-blue-100 text-blue-600'
                    }`}
                  >
                    {movement.type === 'IN' ? (
                      <ArrowDownCircle className="h-5 w-5" />
                    ) : movement.type === 'OUT' ? (
                      <ArrowUpCircle className="h-5 w-5" />
                    ) : (
                      <Package className="h-5 w-5" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{movement.productName}</p>
                    <p className="text-sm text-gray-500">
                      {movement.type === 'IN' ? '+' : movement.type === 'OUT' ? '-' : ''}
                      {movement.quantity} units
                      {movement.reason && ` - ${movement.reason}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">{movement.performedBy}</p>
                    <p className="text-xs text-gray-400">
                      {format(new Date(movement.createdAt), 'MMM dd, HH:mm')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default InventorySection;
