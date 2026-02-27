import { OrderStatus } from '../../../common/constants/order-status.enum';

/**
 * Adapter method names that can be dispatched by status sync.
 */
export type PlatformActionName =
  | 'acceptOrder'
  | 'markPreparing'
  | 'markReady'
  | 'markPickedUp'
  | 'cancelOrder';

/**
 * Maps internal KDS order statuses to platform adapter method names.
 * Used by DeliveryStatusSyncService to determine which adapter method to call
 * when an order status changes in KDS.
 */
export const STATUS_TO_PLATFORM_ACTION: Record<string, PlatformActionName> = {
  [OrderStatus.PENDING]: 'acceptOrder',
  [OrderStatus.PREPARING]: 'markPreparing',
  [OrderStatus.READY]: 'markReady',
  [OrderStatus.SERVED]: 'markPickedUp',
  [OrderStatus.CANCELLED]: 'cancelOrder',
};

/**
 * Statuses that should trigger a sync back to the delivery platform.
 */
export const SYNCABLE_STATUSES = new Set([
  OrderStatus.PENDING,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.SERVED,
  OrderStatus.CANCELLED,
]);

/**
 * Polling-based platforms that need periodic order fetching.
 */
export const POLLING_PLATFORMS = ['GETIR', 'MIGROS', 'TRENDYOL'] as const;

/**
 * Minimum polling intervals per platform (in milliseconds).
 */
export const PLATFORM_POLL_INTERVALS: Record<string, number> = {
  GETIR: 15_000,
  TRENDYOL: 15_000,
  MIGROS: 20_000,
};

/**
 * Maximum consecutive errors before circuit breaker trips.
 */
export const CIRCUIT_BREAKER_THRESHOLD = 10;
