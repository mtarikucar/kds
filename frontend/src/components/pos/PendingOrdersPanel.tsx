import { X, Check, Clock, Phone, MapPin } from 'lucide-react';
import { usePendingOrders, useApproveOrder, useCancelOrder } from '../../features/orders/ordersApi';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { Order } from '../../types';
import Spinner from '../ui/Spinner';
import { useTranslation } from 'react-i18next';

interface PendingOrdersPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const PendingOrdersPanel = ({ isOpen, onClose }: PendingOrdersPanelProps) => {
  const { t } = useTranslation('pos');
  const formatPrice = useFormatCurrency();
  const { data: pendingOrders = [], isLoading } = usePendingOrders();
  const approveOrder = useApproveOrder();
  const cancelOrder = useCancelOrder();

  const handleApprove = async (orderId: string) => {
    try {
      await approveOrder.mutateAsync(orderId);
    } catch (error) {
      console.error('Error approving order:', error);
    }
  };

  const handleReject = async (orderId: string) => {
    if (window.confirm(t('pendingOrders.confirmReject'))) {
      try {
        await cancelOrder.mutateAsync(orderId);
      } catch (error) {
        console.error('Error rejecting order:', error);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-full md:w-[600px] bg-white shadow-2xl z-50 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-6 w-6" />
            <div>
              <h2 className="text-xl font-bold">{t('pendingOrders.title')}</h2>
              <p className="text-sm opacity-90">{pendingOrders.length} {pendingOrders.length !== 1 ? t('pendingOrders.awaitingApproval') : t('pendingOrders.awaitingApproval')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Spinner size="lg" />
            </div>
          ) : pendingOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Clock className="h-16 w-16 mb-4" />
              <p className="text-lg font-medium">{t('pendingOrders.noOrders')}</p>
              <p className="text-sm">{t('pendingOrders.allApproved')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingOrders.map((order: Order) => (
                <div
                  key={order.id}
                  className="bg-white border-2 border-orange-200 rounded-xl shadow-md overflow-hidden"
                >
                  {/* Order Header */}
                  <div className="bg-orange-50 px-4 py-3 border-b border-orange-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-gray-900">
                          #{order.orderNumber}
                        </span>
                        {order.table && (
                          <div className="flex items-center gap-1 text-sm text-gray-600 bg-white px-2 py-1 rounded">
                            <MapPin className="h-3 w-3" />
                            <span>{t('tableLabel')} {order.table.number}</span>
                            {order.table.section && (
                              <span className="text-gray-400">({order.table.section})</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Clock className="h-3 w-3" />
                        {new Date(order.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    {order.customerPhone && (
                      <div className="flex items-center gap-1 text-sm text-gray-600">
                        <Phone className="h-3 w-3" />
                        <span>{order.customerPhone}</span>
                      </div>
                    )}
                  </div>

                  {/* Order Items */}
                  <div className="p-4">
                    <div className="space-y-2 mb-3">
                      {order.orderItems?.map((item) => (
                        <div key={item.id} className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">
                              {item.quantity}x {item.product?.name || t('billRequests.unknownProduct')}
                            </div>
                            {item.modifiers && item.modifiers.length > 0 && (
                              <div className="ml-4 mt-1 space-y-0.5">
                                {item.modifiers.map((mod) => (
                                  <div key={mod.id} className="text-xs text-gray-500">
                                    • {mod.modifier?.displayName || mod.modifier?.name}
                                  </div>
                                ))}
                              </div>
                            )}
                            {item.notes && (
                              <div className="ml-4 mt-1 text-xs text-gray-500 italic">
                                {t('notes')}: {item.notes}
                              </div>
                            )}
                          </div>
                          <span className="text-sm font-semibold text-gray-700 ml-2">
                            {formatPrice(Number(item.subtotal))}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Order Notes */}
                    {order.notes && (
                      <div className="mb-3 p-2 bg-gray-50 rounded text-xs text-gray-600">
                        <strong>{t('billRequests.customerRequestedNote')}:</strong> {order.notes}
                      </div>
                    )}

                    {/* Total */}
                    <div className="border-t pt-3 flex justify-between items-center">
                      <span className="font-bold text-gray-900">{t('pendingOrders.totalAmount')}</span>
                      <span className="text-xl font-bold text-orange-600">
                        {formatPrice(Number(order.finalAmount))}
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="bg-gray-50 px-4 py-3 border-t flex gap-2">
                    <button
                      onClick={() => handleReject(order.id)}
                      disabled={cancelOrder.isPending}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white border-2 border-red-200 text-red-600 rounded-lg hover:bg-red-50 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <X className="h-5 w-5" />
                      {t('pendingOrders.reject')}
                    </button>
                    <button
                      onClick={() => handleApprove(order.id)}
                      disabled={approveOrder.isPending}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {approveOrder.isPending ? (
                        <Spinner size="sm" />
                      ) : (
                        <>
                          <Check className="h-5 w-5" />
                          {t('pendingOrders.approve')}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default PendingOrdersPanel;
