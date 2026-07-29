import { Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOrders } from '../../features/orders/ordersApi';
import { DELIVERY_INBOX_ACTIVE_STATUSES, isDeliveryOrder } from './deliveryInbox';

interface DeliveryInboxButtonProps {
  onOpen: () => void;
}

/**
 * Persistent opener for the POS delivery/package-order inbox
 * (PendingOrdersPanel). The NotificationBar only surfaces while something
 * needs approval — an accepted PREPARING/READY delivery order has no other
 * entry point (the old /admin/delivery-orders page redirects to /pos) — so
 * this compact button stays visible in the POS header at all times.
 *
 * It issues the panel's EXACT query (same filters → same react-query key),
 * so the two share a single cache entry instead of duplicating the fetch.
 * Like the NotificationBar counts, freshness rides the socket-driven
 * 'orders' invalidations (usePosSocket) — no polling here; the panel adds
 * its own 15s refetch only while open.
 */
const DeliveryInboxButton = ({ onOpen }: DeliveryInboxButtonProps) => {
  const { t } = useTranslation('deliveryOrders');
  const { data: orders = [] } = useOrders({
    status: DELIVERY_INBOX_ACTIVE_STATUSES,
  });
  const activeCount = orders.filter(isDeliveryOrder).length;

  return (
    <button
      type="button"
      onClick={onOpen}
      title={t('title')}
      aria-label={t('title')}
      className="relative inline-flex items-center justify-center w-10 h-9 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors shrink-0"
    >
      <Package className="w-4 h-4" />
      {activeCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-white text-[10px] font-bold rounded-full h-4 min-w-[1rem] px-1 flex items-center justify-center">
          {activeCount}
        </span>
      )}
    </button>
  );
};

export default DeliveryInboxButton;
