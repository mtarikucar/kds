import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, ChefHat, CheckCircle2, Utensils, User, Receipt, RefreshCcw, ChevronDown, ChevronUp, ShoppingBag } from 'lucide-react';
import { Order, OrderItem } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import { MenuSettings } from '../../pages/qr-menu/QRMenuLayout';
import { useCartStore } from '../../store/cartStore';
import OrderStatusTimeline from './OrderStatusTimeline';

interface OrdersContentProps {
  orders: Order[];
  settings: MenuSettings;
  tenantId: string | undefined;
  tableId: string | null;
  onCallWaiter: () => void;
  onRequestBill: () => void;
  onBrowseMenu: () => void;
  currency?: string;
}

const OrdersContent: React.FC<OrdersContentProps> = ({
  orders,
  settings,
  tenantId,
  tableId,
  onCallWaiter,
  onRequestBill,
  onBrowseMenu,
  currency = 'TRY',
}) => {
  const { t } = useTranslation('common');
  const addItem = useCartStore(state => state.addItem);
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [reorderingOrderId, setReorderingOrderId] = useState<string | null>(null);

  const toggleOrderExpanded = (orderId: string) => {
    const newExpanded = new Set(expandedOrders);
    if (newExpanded.has(orderId)) {
      newExpanded.delete(orderId);
    } else {
      newExpanded.add(orderId);
    }
    setExpandedOrders(newExpanded);
  };

  const handleReorder = async (order: Order) => {
    if (!order.orderItems) return;

    setReorderingOrderId(order.id);

    // Add each item to cart
    for (const item of order.orderItems) {
      if (item.product) {
        // Convert order item modifiers to cart modifiers format
        const cartModifiers = item.modifiers?.map(mod => ({
          id: mod.modifierId,
          name: mod.modifier?.name || mod.modifier?.displayName || '',
          displayName: mod.modifier?.displayName || '',
          priceAdjustment: mod.modifier?.priceAdjustment || 0,
          quantity: mod.quantity || 1,
        })) || [];

        addItem(item.product, item.quantity, cartModifiers, item.notes || undefined);
      }
    }

    // Simulate a slight delay for feedback
    setTimeout(() => {
      setReorderingOrderId(null);
    }, 800);
  };

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'PENDING_APPROVAL':
        return {
          icon: Clock,
          color: 'text-yellow-600',
          bg: 'bg-yellow-50',
          border: 'border-yellow-200',
          label: t('orderStatus.pendingApproval', 'Awaiting Approval'),
          pulse: true,
        };
      case 'PENDING':
        return {
          icon: Clock,
          color: 'text-blue-600',
          bg: 'bg-blue-50',
          border: 'border-blue-200',
          label: t('orderStatus.pending', 'Confirmed'),
          pulse: true,
        };
      case 'PREPARING':
        return {
          icon: ChefHat,
          color: 'text-orange-600',
          bg: 'bg-orange-50',
          border: 'border-orange-200',
          label: t('orderStatus.preparing', 'Preparing'),
          pulse: true,
        };
      case 'READY':
        return {
          icon: CheckCircle2,
          color: 'text-green-600',
          bg: 'bg-green-50',
          border: 'border-green-200',
          label: t('orderStatus.ready', 'Ready'),
          pulse: false,
        };
      case 'SERVED':
        return {
          icon: Utensils,
          color: 'text-purple-600',
          bg: 'bg-purple-50',
          border: 'border-purple-200',
          label: t('orderStatus.served', 'Served'),
          pulse: false,
        };
      default:
        return {
          icon: Clock,
          color: 'text-slate-600',
          bg: 'bg-slate-50',
          border: 'border-slate-200/60',
          label: status,
          pulse: false,
        };
    }
  };

  const isActiveOrder = (status: string) => {
    return ['PENDING_APPROVAL', 'PENDING', 'PREPARING', 'READY'].includes(status);
  };

  // Separate active and past orders
  const activeOrders = orders.filter(o => isActiveOrder(o.status));
  const pastOrders = orders.filter(o => !isActiveOrder(o.status));

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 mb-20 md:mb-0">
      <div className="max-w-2xl mx-auto">
        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <motion.button
            onClick={onCallWaiter}
            className="bg-white rounded-2xl shadow-md p-5 flex flex-col items-center gap-3 hover:shadow-lg transition-all duration-200"
            whileTap={{ scale: 0.95 }}
            whileHover={{ scale: 1.02 }}
          >
            <div className="p-3 rounded-full" style={{ backgroundColor: `${settings.primaryColor}15` }}>
              <User className="h-6 w-6" style={{ color: settings.primaryColor }} />
            </div>
            <span className="font-semibold text-slate-900 text-center text-sm">
              {t('waiter.call', 'Call Waiter')}
            </span>
          </motion.button>
          <motion.button
            onClick={onRequestBill}
            className="bg-white rounded-2xl shadow-md p-5 flex flex-col items-center gap-3 hover:shadow-lg transition-all duration-200"
            whileTap={{ scale: 0.95 }}
            whileHover={{ scale: 1.02 }}
          >
            <div className="p-3 rounded-full" style={{ backgroundColor: `${settings.secondaryColor}15` }}>
              <Receipt className="h-6 w-6" style={{ color: settings.secondaryColor }} />
            </div>
            <span className="font-semibold text-slate-900 text-center text-sm">
              {t('bill.request', 'Request Bill')}
            </span>
          </motion.button>
        </div>

        {/* Orders List */}
        {orders.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-md p-8 text-center"
          >
            <motion.div
              animate={{ y: [0, -5, 0] }}
              transition={{ repeat: Infinity, duration: 2 }}
            >
              <ShoppingBag className="h-16 w-16 text-slate-300 mx-auto mb-4" />
            </motion.div>
            <h2 className="text-xl font-semibold text-slate-700 mb-2">
              {t('orders.noOrders', 'No orders yet')}
            </h2>
            <p className="text-slate-500 mb-6">
              {t('orders.noOrdersDescription', 'Start by browsing our menu')}
            </p>
            <motion.button
              onClick={onBrowseMenu}
              className="px-6 py-3 rounded-xl font-semibold text-white transition-all"
              style={{ backgroundColor: settings.primaryColor }}
              whileTap={{ scale: 0.95 }}
              whileHover={{ scale: 1.05 }}
            >
              {t('common.browseMenu', 'Browse Menu')}
            </motion.button>
          </motion.div>
        ) : (
          <div className="space-y-6">
            {/* Active Orders Section */}
            {activeOrders.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">
                  {t('orders.activeOrders', 'Active Orders')}
                </h2>
                <div className="space-y-4">
                  {activeOrders.map((order, index) => {
                    const statusInfo = getStatusInfo(order.status);
                    const StatusIcon = statusInfo.icon;
                    const isExpanded = expandedOrders.has(order.id);

                    return (
                      <motion.div
                        key={order.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="bg-white rounded-2xl shadow-md overflow-hidden"
                      >
                        {/* Order Header with Status */}
                        <div className={cn('p-4 border-b', statusInfo.border, statusInfo.bg)}>
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="relative">
                                <StatusIcon className={cn('h-5 w-5', statusInfo.color)} />
                                {statusInfo.pulse && (
                                  <span className="absolute inset-0 animate-ping">
                                    <StatusIcon className={cn('h-5 w-5', statusInfo.color, 'opacity-50')} />
                                  </span>
                                )}
                              </div>
                              <span className={cn('font-semibold', statusInfo.color)}>
                                {statusInfo.label}
                              </span>
                            </div>
                            <span className="text-sm text-slate-600 font-mono">
                              #{order.orderNumber}
                            </span>
                          </div>

                          {/* Status Timeline */}
                          <OrderStatusTimeline
                            currentStatus={order.status}
                            primaryColor={settings.primaryColor}
                            compact
                          />
                        </div>

                        {/* Order Items */}
                        <div className="p-4">
                          <button
                            onClick={() => toggleOrderExpanded(order.id)}
                            className="w-full flex items-center justify-between text-left"
                          >
                            <span className="text-sm text-slate-600">
                              {order.orderItems?.length || 0} {t('orders.items', 'items')}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-slate-400" />
                            )}
                          </button>

                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="mt-3 space-y-2">
                                  {order.orderItems?.map(item => (
                                    <div key={item.id} className="flex justify-between items-start py-2 border-b border-slate-100 last:border-0">
                                      <div className="flex-1">
                                        <span className="font-medium text-slate-900">
                                          {item.quantity}x {item.product?.name}
                                        </span>
                                        {item.modifiers && item.modifiers.length > 0 && (
                                          <div className="text-xs text-slate-500 mt-0.5">
                                            {item.modifiers.map(m => m.modifier?.displayName || '').filter(Boolean).join(', ')}
                                          </div>
                                        )}
                                      </div>
                                      <span className="text-sm font-semibold text-slate-600">
                                        {formatCurrency(item.subtotal || 0, currency)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Total */}
                          <div className="flex justify-between font-bold mt-3 pt-3 border-t">
                            <span>{t('cart.total', 'Total')}</span>
                            <span style={{ color: settings.primaryColor }}>
                              {formatCurrency(order.totalAmount, currency)}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Past Orders Section */}
            {pastOrders.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">
                  {t('orders.pastOrders', 'Past Orders')}
                </h2>
                <div className="space-y-4">
                  {pastOrders.map((order, index) => {
                    const statusInfo = getStatusInfo(order.status);
                    const isExpanded = expandedOrders.has(order.id);
                    const isReordering = reorderingOrderId === order.id;

                    return (
                      <motion.div
                        key={order.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="bg-white rounded-2xl shadow-sm overflow-hidden border border-slate-100"
                      >
                        {/* Order Header */}
                        <div className="p-4 flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-mono text-slate-600">
                                #{order.orderNumber}
                              </span>
                              <span className={cn(
                                'text-xs px-2 py-0.5 rounded-full',
                                statusInfo.bg,
                                statusInfo.color
                              )}>
                                {statusInfo.label}
                              </span>
                            </div>
                            <span className="text-xs text-slate-500">
                              {new Date(order.createdAt).toLocaleString()}
                            </span>
                          </div>

                          {/* Reorder Button */}
                          <motion.button
                            onClick={() => handleReorder(order)}
                            disabled={isReordering}
                            className={cn(
                              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
                              isReordering
                                ? 'bg-green-100 text-green-700'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            )}
                            whileTap={{ scale: 0.95 }}
                          >
                            <RefreshCcw className={cn('h-4 w-4', isReordering && 'animate-spin')} />
                            {isReordering
                              ? t('orders.adding', 'Adding...')
                              : t('orders.reorder', 'Reorder')
                            }
                          </motion.button>
                        </div>

                        {/* Expandable Items */}
                        <button
                          onClick={() => toggleOrderExpanded(order.id)}
                          className="w-full px-4 py-2 flex items-center justify-between bg-slate-50 text-sm text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                          <span>
                            {order.orderItems?.length || 0} {t('orders.items', 'items')} •{' '}
                            <span className="font-semibold" style={{ color: settings.primaryColor }}>
                              {formatCurrency(order.totalAmount, currency)}
                            </span>
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="p-4 space-y-2">
                                {order.orderItems?.map(item => (
                                  <div key={item.id} className="flex justify-between items-start py-2 border-b border-slate-100 last:border-0">
                                    <div className="flex-1">
                                      <span className="font-medium text-slate-900 text-sm">
                                        {item.quantity}x {item.product?.name}
                                      </span>
                                      {item.modifiers && item.modifiers.length > 0 && (
                                        <div className="text-xs text-slate-500 mt-0.5">
                                          {item.modifiers.map(m => m.modifier?.displayName || '').filter(Boolean).join(', ')}
                                        </div>
                                      )}
                                    </div>
                                    <span className="text-sm text-slate-600">
                                      {formatCurrency(item.subtotal || 0, currency)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrdersContent;
