import { PlatformType } from './platform.enum';

// Internal unified order status
export enum PlatformOrderStatus {
  RECEIVED = 'RECEIVED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  PICKED_UP = 'PICKED_UP',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

// Trendyol Go status mapping
export enum TrendyolOrderStatus {
  NEW = 'NEW',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  ON_THE_WAY = 'ON_THE_WAY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

// Yemeksepeti status mapping
export enum YemeksepetiOrderStatus {
  WAITING_CONFIRMATION = 'WAITING_CONFIRMATION',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  PREPARING = 'PREPARING',
  ON_THE_WAY = 'ON_THE_WAY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

// Getir status mapping
export enum GetirOrderStatus {
  NEW = 'NEW',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  PREPARING = 'PREPARING',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  ON_THE_WAY = 'ON_THE_WAY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

// Migros status mapping
export enum MigrosOrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PICKING = 'PICKING',
  READY = 'READY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

// Fuudy status mapping
export enum FuudyOrderStatus {
  NEW = 'NEW',
  ACCEPTED = 'ACCEPTED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

// Status mapping from platform-specific to internal status
export const PLATFORM_STATUS_MAP: Record<
  PlatformType,
  Record<string, PlatformOrderStatus>
> = {
  [PlatformType.TRENDYOL]: {
    [TrendyolOrderStatus.NEW]: PlatformOrderStatus.RECEIVED,
    [TrendyolOrderStatus.ACCEPTED]: PlatformOrderStatus.ACCEPTED,
    [TrendyolOrderStatus.REJECTED]: PlatformOrderStatus.REJECTED,
    [TrendyolOrderStatus.PREPARING]: PlatformOrderStatus.PREPARING,
    [TrendyolOrderStatus.READY]: PlatformOrderStatus.READY,
    [TrendyolOrderStatus.ON_THE_WAY]: PlatformOrderStatus.PICKED_UP,
    [TrendyolOrderStatus.DELIVERED]: PlatformOrderStatus.DELIVERED,
    [TrendyolOrderStatus.CANCELLED]: PlatformOrderStatus.CANCELLED,
  },
  [PlatformType.YEMEKSEPETI]: {
    [YemeksepetiOrderStatus.WAITING_CONFIRMATION]: PlatformOrderStatus.RECEIVED,
    [YemeksepetiOrderStatus.CONFIRMED]: PlatformOrderStatus.ACCEPTED,
    [YemeksepetiOrderStatus.REJECTED]: PlatformOrderStatus.REJECTED,
    [YemeksepetiOrderStatus.PREPARING]: PlatformOrderStatus.PREPARING,
    [YemeksepetiOrderStatus.ON_THE_WAY]: PlatformOrderStatus.PICKED_UP,
    [YemeksepetiOrderStatus.DELIVERED]: PlatformOrderStatus.DELIVERED,
    [YemeksepetiOrderStatus.CANCELLED]: PlatformOrderStatus.CANCELLED,
  },
  [PlatformType.GETIR]: {
    [GetirOrderStatus.NEW]: PlatformOrderStatus.RECEIVED,
    [GetirOrderStatus.ACCEPTED]: PlatformOrderStatus.ACCEPTED,
    [GetirOrderStatus.REJECTED]: PlatformOrderStatus.REJECTED,
    [GetirOrderStatus.PREPARING]: PlatformOrderStatus.PREPARING,
    [GetirOrderStatus.READY_FOR_PICKUP]: PlatformOrderStatus.READY,
    [GetirOrderStatus.ON_THE_WAY]: PlatformOrderStatus.PICKED_UP,
    [GetirOrderStatus.DELIVERED]: PlatformOrderStatus.DELIVERED,
    [GetirOrderStatus.CANCELLED]: PlatformOrderStatus.CANCELLED,
  },
  [PlatformType.MIGROS]: {
    [MigrosOrderStatus.PENDING]: PlatformOrderStatus.RECEIVED,
    [MigrosOrderStatus.CONFIRMED]: PlatformOrderStatus.ACCEPTED,
    [MigrosOrderStatus.PICKING]: PlatformOrderStatus.PREPARING,
    [MigrosOrderStatus.READY]: PlatformOrderStatus.READY,
    [MigrosOrderStatus.DELIVERED]: PlatformOrderStatus.DELIVERED,
    [MigrosOrderStatus.CANCELLED]: PlatformOrderStatus.CANCELLED,
  },
  [PlatformType.FUUDY]: {
    [FuudyOrderStatus.NEW]: PlatformOrderStatus.RECEIVED,
    [FuudyOrderStatus.ACCEPTED]: PlatformOrderStatus.ACCEPTED,
    [FuudyOrderStatus.PREPARING]: PlatformOrderStatus.PREPARING,
    [FuudyOrderStatus.READY]: PlatformOrderStatus.READY,
    [FuudyOrderStatus.DELIVERED]: PlatformOrderStatus.DELIVERED,
    [FuudyOrderStatus.CANCELLED]: PlatformOrderStatus.CANCELLED,
  },
};

// Sync log operation types
export enum SyncOperationType {
  ORDER_RECEIVED = 'ORDER_RECEIVED',
  ORDER_STATUS_PUSH = 'ORDER_STATUS_PUSH',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  STATUS_UPDATE = 'STATUS_UPDATE',
  MENU_SYNC = 'MENU_SYNC',
  AVAILABILITY_SYNC = 'AVAILABILITY_SYNC',
  PRICE_SYNC = 'PRICE_SYNC',
  RESTAURANT_STATUS = 'RESTAURANT_STATUS',
}

export enum SyncDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
}

export enum SyncStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  PARTIAL = 'PARTIAL',
}

export enum DeadLetterStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  RESOLVED = 'RESOLVED',
  ABANDONED = 'ABANDONED',
}
