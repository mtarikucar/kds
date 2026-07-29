import { Order, OrderStatus } from '../../types';

// Delivery orders travel a wider lifecycle (accepted → preparing → ready)
// than the internal QR/in-house approve queue (which only lives in
// PENDING_APPROVAL). The POS PendingOrdersPanel is the single "Paket
// Siparişleri" inbox (the standalone /admin/delivery-orders page redirects
// to /pos), so both the panel and the header DeliveryInboxButton badge fetch
// this full active window. Sharing the exact filter string keeps their
// react-query keys identical → one cache entry, no duplicated fetching.
export const DELIVERY_INBOX_ACTIVE_STATUSES = [
  OrderStatus.PENDING_APPROVAL,
  OrderStatus.PENDING,
  OrderStatus.PREPARING,
  OrderStatus.READY,
].join(',');

export const isDeliveryOrder = (o: Order) => !!o.source && !!o.externalOrderId;
