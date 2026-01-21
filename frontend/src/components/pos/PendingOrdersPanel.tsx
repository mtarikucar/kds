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
      // Error handled by mutation
    }
  };

  const handleReject = async (orderId: string) => {
    if (window.confirm(t('pendingOrders.confirmReject'))) {
      try {
        await cancelOrder.mutateAsync(orderId);
      } catch (error) {
        // Error handled by mutation
      }
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-full md:w-[600px] bg-white shadow-2xl z-50 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-primary-500 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-heading font-bold">{t('pendingOrders.title')}</h2>
              <p className="text-sm text-white/80">{pendingOrders.length} {t('pendingOrders.awaitingApproval')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Spinner size="lg" />
            </div>
          ) : pendingOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                <Clock className="h-8 w-8 text-slate-300" />
              </div>
              <p className="text-lg font-medium text-slate-500">{t('pendingOrders.noOrders')}</p>
              <p className="text-sm text-slate-400">{t('pendingOrders.allApproved')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingOrders.map((order: Order) => (
                <div
                  key={order.id}
                  className="bg-white rounded-xl border border-amber-200/60 shadow-sm overflow-hidden"
                >
                  {/* Order Header */}
                  <div className="bg-amber-50/80 px-5 py-4 border-b border-amber-100">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg font-bold text-slate-900">
                          #{order.orderNumber}
                        </span>
                        {order.table && (
                          <div className="flex items-center gap-1 text-sm text-slate-600 bg-white px-2.5 py-1 rounded-lg border border-slate-200/60">
                            <MapPin className="h-3.5 w-3.5" />
                            <span>{t('tableLabel')} {order.table.number}</span>
                            {order.table.section && (
                              <span className="text-slate-400">({order.table.section})</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Clock className="h-3.5 w-3.5" />
                        {new Date(order.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    {order.customerPhone && (
                      <div className="flex items-center gap-1.5 text-sm text-slate-600">
                        <Phone className="h-3.5 w-3.5" />
                        <span>{order.customerPhone}</span>
                      </div>
                    )}
                  </div>

                  {/* Order Items */}
                  <div className="p-5">
                    <div className="space-y-2.5 mb-4">
                      {order.orderItems?.map((item) => (
                        <div key={item.id} className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-medium text-slate-900">
                              {item.quantity}x {item.product?.name || t('billRequests.unknownProduct')}
                            </div>
                            {item.modifiers && item.modifiers.length > 0 && (
                              <div className="ml-4 mt-1 space-y-0.5">
                                {item.modifiers.map((mod) => (
                                  <div key={mod.id} className="text-xs text-slate-500">
                                    • {mod.modifier?.displayName || mod.modifier?.name}
                                  </div>
                                ))}
                              </div>
                            )}
                            {item.notes && (
                              <div className="ml-4 mt-1 text-xs text-slate-500 italic">
                                {t('notes')}: {item.notes}
                              </div>
                            )}
                          </div>
                          <span className="text-sm font-semibold text-slate-700 ml-2">
                            {formatPrice(Number(item.subtotal))}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Order Notes */}
                    {order.notes && (
                      <div className="mb-4 p-3 bg-slate-50 rounded-lg text-xs text-slate-600 border border-slate-100">
                        <strong>{t('billRequests.customerRequestedNote')}:</strong> {order.notes}
                      </div>
                    )}

                    {/* Total */}
                    <div className="border-t border-slate-100 pt-4 flex justify-between items-center">
                      <span className="font-bold text-slate-900">{t('pendingOrders.totalAmount')}</span>
                      <span className="text-xl font-bold text-amber-600">
                        {formatPrice(Number(order.finalAmount))}
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="bg-slate-50/80 px-5 py-4 border-t border-slate-100 flex gap-3">
                    <button
                      onClick={() => handleReject(order.id)}
                      disabled={cancelOrder.isPending}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white border border-red-200 text-red-600 rounded-xl hover:bg-red-50 font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <X className="h-5 w-5" />
                      {t('pendingOrders.reject')}
                    </button>
                    <button
                      onClick={() => handleApprove(order.id)}
                      disabled={approveOrder.isPending}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-semibold transition-all duration-200 shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {approveOrder.isPending ? (
                        <Spinner size="sm" color="white" />
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
