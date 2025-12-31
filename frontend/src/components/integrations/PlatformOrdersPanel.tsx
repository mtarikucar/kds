import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, CheckCircle, XCircle, Eye, Truck } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import Badge from '../ui/Badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { Input } from '../ui/Input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog';
import {
  useGetPlatformOrders,
  useAcceptPlatformOrder,
  useRejectPlatformOrder,
  useGetIntegrationStats,
  PlatformType,
  PlatformLabels,
  PlatformColors,
  PlatformOrder,
} from '../../features/integrations/deliveryApi';
import { toast } from 'sonner';

const PlatformOrdersPanel = () => {
  const { t } = useTranslation('settings');
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedOrder, setSelectedOrder] = useState<PlatformOrder | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [prepTime, setPrepTime] = useState('30');

  const { data: ordersData, isLoading, refetch } = useGetPlatformOrders({
    platformType: filterPlatform !== 'all' ? filterPlatform as PlatformType : undefined,
    status: filterStatus !== 'all' ? filterStatus : undefined,
    limit: 50,
  });

  const { data: stats } = useGetIntegrationStats();
  const acceptOrder = useAcceptPlatformOrder();
  const rejectOrder = useRejectPlatformOrder();

  const orders = ordersData?.orders || [];

  const handleAccept = async (order: PlatformOrder) => {
    try {
      await acceptOrder.mutateAsync({
        id: order.id,
        estimatedPrepTime: parseInt(prepTime) || 30,
      });
      toast.success(t('delivery.orderAccepted'));
      refetch();
      setSelectedOrder(null);
    } catch {
      toast.error(t('delivery.acceptFailed'));
    }
  };

  const handleReject = async (order: PlatformOrder) => {
    if (!rejectReason) {
      toast.error(t('delivery.rejectReasonRequired'));
      return;
    }

    try {
      await rejectOrder.mutateAsync({
        id: order.id,
        reason: rejectReason,
      });
      toast.success(t('delivery.orderRejected'));
      refetch();
      setSelectedOrder(null);
      setRejectReason('');
    } catch {
      toast.error(t('delivery.rejectFailed'));
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'RECEIVED':
        return <Badge variant="warning">{t('delivery.status.received')}</Badge>;
      case 'ACCEPTED':
      case 'PENDING':
        return <Badge variant="primary">{t('delivery.status.accepted')}</Badge>;
      case 'PREPARING':
        return <Badge variant="info">{t('delivery.status.preparing')}</Badge>;
      case 'READY':
        return <Badge variant="success">{t('delivery.status.ready')}</Badge>;
      case 'DELIVERED':
        return <Badge variant="success">{t('delivery.status.delivered')}</Badge>;
      case 'REJECTED':
      case 'CANCELLED':
        return <Badge variant="danger">{t('delivery.status.cancelled')}</Badge>;
      default:
        return <Badge variant="default">{status}</Badge>;
    }
  };

  const getPlatformBadge = (platformType: string) => {
    const color = PlatformColors[platformType as PlatformType] || '#666';
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white"
        style={{ backgroundColor: color }}
      >
        {PlatformLabels[platformType as PlatformType] || platformType}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600">
                {stats?.todayOrders || 0}
              </div>
              <div className="text-sm text-gray-500">{t('delivery.todayOrders')}</div>
            </div>
          </CardContent>
        </Card>
        {stats?.ordersByPlatform?.slice(0, 3).map((stat) => (
          <Card key={stat.platformType}>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ color: PlatformColors[stat.platformType as PlatformType] }}>
                  {stat._count}
                </div>
                <div className="text-sm text-gray-500">
                  {PlatformLabels[stat.platformType as PlatformType]}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            {t('delivery.platformOrders')}
          </CardTitle>
          <CardDescription>{t('delivery.platformOrdersDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 mb-6">
            <Select value={filterPlatform} onValueChange={setFilterPlatform}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t('delivery.allPlatforms')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('delivery.allPlatforms')}</SelectItem>
                {Object.values(PlatformType).map((type) => (
                  <SelectItem key={type} value={type}>
                    {PlatformLabels[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t('delivery.allStatuses')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('delivery.allStatuses')}</SelectItem>
                <SelectItem value="RECEIVED">{t('delivery.status.received')}</SelectItem>
                <SelectItem value="ACCEPTED">{t('delivery.status.accepted')}</SelectItem>
                <SelectItem value="PREPARING">{t('delivery.status.preparing')}</SelectItem>
                <SelectItem value="READY">{t('delivery.status.ready')}</SelectItem>
                <SelectItem value="DELIVERED">{t('delivery.status.delivered')}</SelectItem>
                <SelectItem value="CANCELLED">{t('delivery.status.cancelled')}</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" onClick={() => refetch()}>
              {t('delivery.refresh')}
            </Button>
          </div>

          {/* Orders Table */}
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">
              {t('common.loading')}...
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {t('delivery.noOrders')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-gray-600">
                      {t('delivery.orderNumber')}
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">
                      {t('delivery.platform')}
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">
                      {t('delivery.customer')}
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">
                      {t('delivery.total')}
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">
                      {t('delivery.status')}
                    </th>
                    <th className="text-left py-3 px-4 font-medium text-gray-600">
                      {t('delivery.time')}
                    </th>
                    <th className="text-right py-3 px-4 font-medium text-gray-600">
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="font-medium">
                          #{order.platformOrderNumber || order.platformOrderId.slice(0, 8)}
                        </div>
                        {order.order && (
                          <div className="text-xs text-gray-500">
                            Internal: #{order.order.orderNumber}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {getPlatformBadge(order.platformType)}
                      </td>
                      <td className="py-3 px-4">
                        <div>{(order.customerInfo as any)?.name || '-'}</div>
                        <div className="text-xs text-gray-500">
                          {(order.customerInfo as any)?.phone || ''}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-medium">
                        {Number(order.platformTotal).toFixed(2)} TL
                      </td>
                      <td className="py-3 px-4">
                        {getStatusBadge(order.internalStatus)}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {new Date(order.createdAt).toLocaleTimeString()}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedOrder(order)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {order.internalStatus === 'RECEIVED' && (
                            <>
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => {
                                  setSelectedOrder(order);
                                  handleAccept(order);
                                }}
                                disabled={acceptOrder.isPending}
                              >
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => setSelectedOrder(order)}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Order Detail Modal */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('delivery.orderDetails')} #{selectedOrder?.platformOrderNumber || selectedOrder?.platformOrderId.slice(0, 8)}
            </DialogTitle>
          </DialogHeader>

          {selectedOrder && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                {getPlatformBadge(selectedOrder.platformType)}
                {getStatusBadge(selectedOrder.internalStatus)}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-gray-500">{t('delivery.customer')}</div>
                  <div className="font-medium">{(selectedOrder.customerInfo as any)?.name || '-'}</div>
                  <div>{(selectedOrder.customerInfo as any)?.phone || ''}</div>
                </div>
                <div>
                  <div className="text-gray-500">{t('delivery.total')}</div>
                  <div className="font-medium text-lg">
                    {Number(selectedOrder.platformTotal).toFixed(2)} TL
                  </div>
                </div>
              </div>

              {(selectedOrder.deliveryInfo as any)?.address && (
                <div>
                  <div className="text-gray-500 text-sm">{t('delivery.address')}</div>
                  <div className="text-sm">{(selectedOrder.deliveryInfo as any).address}</div>
                </div>
              )}

              {selectedOrder.internalStatus === 'RECEIVED' && (
                <div className="border-t pt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('delivery.prepTime')}
                    </label>
                    <Input
                      type="number"
                      value={prepTime}
                      onChange={(e) => setPrepTime(e.target.value)}
                      placeholder="30"
                      className="w-32"
                    />
                    <span className="text-sm text-gray-500 ml-2">{t('delivery.minutes')}</span>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('delivery.rejectReason')}
                    </label>
                    <Input
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder={t('delivery.rejectReasonPlaceholder')}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {selectedOrder?.internalStatus === 'RECEIVED' && (
              <>
                <Button
                  variant="danger"
                  onClick={() => handleReject(selectedOrder)}
                  disabled={rejectOrder.isPending}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  {t('delivery.reject')}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => handleAccept(selectedOrder)}
                  disabled={acceptOrder.isPending}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  {t('delivery.accept')}
                </Button>
              </>
            )}
            {selectedOrder?.internalStatus !== 'RECEIVED' && (
              <Button variant="outline" onClick={() => setSelectedOrder(null)}>
                {t('common.close')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PlatformOrdersPanel;
