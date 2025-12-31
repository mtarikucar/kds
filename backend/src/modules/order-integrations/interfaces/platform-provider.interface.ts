import { PlatformType, PlatformOrderStatus } from '../constants';

// Result types for platform operations
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

export interface MenuSyncResult {
  success: boolean;
  syncedProducts: number;
  failedProducts: number;
  syncedModifiers: number;
  failedModifiers: number;
  errors?: Array<{ productId: string; error: string }>;
}

export interface OrderAcceptResult {
  success: boolean;
  estimatedPrepTime?: number;
  message?: string;
}

export interface OrderRejectResult {
  success: boolean;
  message?: string;
}

export interface OrderStatusUpdateResult {
  success: boolean;
  newStatus: string;
  message?: string;
}

export interface RestaurantStatus {
  isOpen: boolean;
  closedReason?: string;
  nextOpenTime?: Date;
}

// Platform order structure (normalized from platform-specific formats)
export interface PlatformOrderData {
  platformOrderId: string;
  platformOrderNumber?: string;
  platformType: PlatformType;
  platformStatus: string;

  // Customer info
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;

  // Delivery info
  deliveryAddress?: string;
  deliveryInstructions?: string;
  estimatedDeliveryTime?: Date;

  // Order items
  items: PlatformOrderItem[];

  // Financial
  subtotal: number;
  deliveryFee?: number;
  discount?: number;
  total: number;
  isPrepaid: boolean;
  paymentMethod?: string;

  // Timestamps
  createdAt: Date;

  // Raw data for storage
  rawData: unknown;
}

export interface PlatformOrderItem {
  platformProductId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes?: string;
  modifiers?: PlatformOrderItemModifier[];
}

export interface PlatformOrderItemModifier {
  platformModifierId: string;
  name: string;
  quantity: number;
  price: number;
}

// Product/Menu sync structures
export interface ProductSyncData {
  productId: string;
  platformProductId?: string;
  name: string;
  description?: string;
  price: number;
  categoryId?: string;
  isAvailable: boolean;
  imageUrl?: string;
  modifierGroups?: ModifierGroupSyncData[];
}

export interface ModifierGroupSyncData {
  groupId: string;
  platformGroupId?: string;
  name: string;
  selectionType: 'SINGLE' | 'MULTIPLE';
  minSelections: number;
  maxSelections?: number;
  isRequired: boolean;
  modifiers: ModifierSyncData[];
}

export interface ModifierSyncData {
  modifierId: string;
  platformModifierId?: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

export interface CategorySyncData {
  categoryId: string;
  platformCategoryId?: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

// Platform credentials structure (stored in IntegrationSettings.config)
export interface BasePlatformCredentials {
  isConfigured: boolean;
  autoAccept: boolean;
  defaultPrepTime: number; // minutes
}

export interface TrendyolCredentials extends BasePlatformCredentials {
  apiKey: string;
  apiSecret: string;
  storeId: string;
  webhookSecret?: string;
}

export interface YemeksepetiCredentials extends BasePlatformCredentials {
  clientId: string;
  clientSecret: string;
  vendorId: string;
  webhookSecret?: string;
  accessToken?: string;
  tokenExpiresAt?: Date;
}

export interface GetirCredentials extends BasePlatformCredentials {
  apiKey: string;
  restaurantId: string;
  webhookSecret?: string;
}

export interface MigrosCredentials extends BasePlatformCredentials {
  clientId: string;
  clientSecret: string;
  storeCode: string;
  certificatePath?: string;
  webhookSecret?: string;
}

export interface FuudyCredentials extends BasePlatformCredentials {
  apiKey: string;
  restaurantId: string;
  webhookSecret?: string;
  ipWhitelist?: string[];
}

export type PlatformCredentials =
  | TrendyolCredentials
  | YemeksepetiCredentials
  | GetirCredentials
  | MigrosCredentials
  | FuudyCredentials;

/**
 * Interface for all platform providers
 * Implements the provider pattern for handling multiple delivery platforms
 */
export interface IPlatformProvider {
  // Platform identification
  readonly platformType: PlatformType;

  // Initialization
  initialize(tenantId: string): Promise<void>;
  setTenantContext(tenantId: string): void;

  // Order operations
  acceptOrder(
    platformOrderId: string,
    estimatedPrepTime?: number,
  ): Promise<OrderAcceptResult>;
  rejectOrder(
    platformOrderId: string,
    reason: string,
  ): Promise<OrderRejectResult>;
  updateOrderStatus(
    platformOrderId: string,
    status: PlatformOrderStatus,
  ): Promise<OrderStatusUpdateResult>;

  // Menu operations
  syncMenu(
    products: ProductSyncData[],
    categories: CategorySyncData[],
  ): Promise<MenuSyncResult>;
  syncProductAvailability(
    platformProductId: string,
    isAvailable: boolean,
  ): Promise<void>;
  syncProductPrice(platformProductId: string, price: number): Promise<void>;

  // Restaurant operations
  setRestaurantOpen(): Promise<void>;
  setRestaurantClosed(reason?: string): Promise<void>;
  getRestaurantStatus(): Promise<RestaurantStatus>;

  // Polling (for platforms without webhooks or as fallback)
  fetchNewOrders(since?: Date): Promise<PlatformOrderData[]>;

  // Get order status from platform
  getOrderStatus(platformOrderId: string): Promise<string>;

  // Webhook verification
  verifyWebhook(payload: unknown, headers: Record<string, string>): boolean;

  // Parse incoming webhook payload to normalized format
  parseWebhookPayload(payload: unknown): PlatformOrderData | null;

  // Configuration
  isConfigured(): Promise<boolean>;
  testConnection(): Promise<ConnectionTestResult>;
  getCredentials(): Promise<PlatformCredentials | null>;
}
