export enum WebhookEventType {
  // Order events
  ORDER_CREATED = 'ORDER_CREATED',
  ORDER_UPDATED = 'ORDER_UPDATED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  ORDER_ACCEPTED = 'ORDER_ACCEPTED',
  ORDER_REJECTED = 'ORDER_REJECTED',
  ORDER_READY = 'ORDER_READY',
  ORDER_DELIVERED = 'ORDER_DELIVERED',

  // Menu events
  MENU_UPDATED = 'MENU_UPDATED',
  PRODUCT_UPDATED = 'PRODUCT_UPDATED',
  PRODUCT_AVAILABILITY_CHANGED = 'PRODUCT_AVAILABILITY_CHANGED',

  // Restaurant events
  RESTAURANT_OPENED = 'RESTAURANT_OPENED',
  RESTAURANT_CLOSED = 'RESTAURANT_CLOSED',

  // System events
  CONNECTION_TEST = 'CONNECTION_TEST',
  PING = 'PING',
}

// Trendyol webhook event types
export enum TrendyolWebhookEvent {
  ORDER_CREATED = 'order.created',
  ORDER_CANCELLED = 'order.cancelled',
  ORDER_UPDATED = 'order.updated',
}

// Yemeksepeti webhook event types
export enum YemeksepetiWebhookEvent {
  NEW_ORDER = 'new_order',
  ORDER_CANCELLED = 'order_cancelled',
  ORDER_STATUS_UPDATED = 'order_status_updated',
}

// Getir webhook event types
export enum GetirWebhookEvent {
  ORDER_RECEIVED = 'orderReceived',
  ORDER_CANCELLED = 'orderCancelled',
  ORDER_STATUS_CHANGED = 'orderStatusChanged',
}

// Migros webhook event types
export enum MigrosWebhookEvent {
  ORDER_CREATED = 'ORDER_CREATED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
}

// Fuudy webhook event types
export enum FuudyWebhookEvent {
  NEW_ORDER = 'new_order',
  ORDER_CANCELLED = 'order_cancelled',
}
