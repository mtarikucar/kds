// User & Auth Types
export enum UserRole {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  WAITER = 'WAITER',
  KITCHEN = 'KITCHEN',
  COURIER = 'COURIER',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Required from registration onward; null/empty only for a social signup
   *  that hasn't completed onboarding yet → drives the completion gate. */
  phone?: string | null;
  /** Saved UI language preference (null → client-side i18n default). */
  locale?: string | null;
  role: string;
  tenantId: string | null;
  /** Restaurant (tenant) display name. Populated by GET /auth/profile so the
   *  /welcome form can prefill the business name instead of forcing a blind
   *  retype; token-minting responses may omit it. */
  tenantName?: string | null;
  /** v3.0.0 — the user's home branch. Hard-restricted roles
   *  (WAITER/KITCHEN/COURIER) always carry a non-null value; ADMIN /
   *  MANAGER may carry null when they legitimately roam (in that
   *  case the BranchPicker forces an explicit selection before any
   *  branch-scoped request fires). */
  primaryBranchId: string | null;
  /** v3.0.0 — the allow-list BranchGuard reads on every request.
   *  ADMIN with an empty list = wildcard tenant access. */
  allowedBranchIds: string[];
  /** True only for the synthetic demo-restaurant admin returned by
   *  POST /auth/demo-session. The banner/source-of-truth for demo mode is
   *  authStore.demoMode (survives a profile refetch that drops this flag). */
  isDemo?: boolean;
  status?: UserStatus | string;
  approvedAt?: string;
  approvedById?: string;
  approvedBy?: { id: string; firstName: string; lastName: string };
  createdAt?: string;
  updatedAt?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /** Required (E.164). PayTR checkout needs a phone. */
  phone: string;
  role?: UserRole;
  restaurantName?: string;
  tenantId?: string;
  /**
   * Required. The country the restaurant operates in — drives tax bands,
   * currency, phone region and receipt locale server-side (see backend
   * COUNTRY_PROFILES). The operator's own explicit choice, pre-filled from
   * the phone's E.164 region as a suggestion only. Must be one of
   * SUPPORTED_COUNTRY_CODES (frontend/src/lib/countries.ts).
   */
  countryCode: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

// Tenant Types
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  currency: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTenantDto {
  name: string;
  slug: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  currency?: string;
  timezone?: string;
}

export interface UpdateTenantDto extends Partial<CreateTenantDto> {
  isActive?: boolean;
}

// Category Types
export interface Category {
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCategoryDto {
  name: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateCategoryDto extends Partial<CreateCategoryDto> {}

// Product Image Types
export interface ProductImage {
  id: string;
  url: string;
  filename: string;
  size: number;
  mimeType: string;
  order?: number; // Optional: only present when fetched with product (from junction table)
  tenantId: string;
  createdAt: string;
}

// Product Types
export interface Product {
  id: string;
  name: string;
  description: string | null;
  ingredients?: string | null; // customer-facing "içindekiler" (contents)
  price: number;
  image: string | null; // Legacy field, kept for backwards compatibility
  images?: ProductImage[]; // New multi-image support
  // 3D / AR (menu AI-AR feature). Present in the QR menu only when a model is
  // READY; the admin product editor also reads model3dStatus via its own hook.
  model3dUrl?: string | null; // GLB (Android Scene Viewer / WebXR)
  model3dUsdzUrl?: string | null; // USDZ (iOS AR Quick Look)
  videoUrl?: string | null; // fal.ai ingredients video (dish → ingredients)
  modifierGroups?: ModifierGroup[]; // Available modifiers for this product
  categoryId: string;
  category?: Category;
  currentStock: number;
  stockTracked: boolean;
  isAvailable: boolean;
  displayOrder: number;
  taxRate?: number; // KDV rate (0/1/10/20); backend defaults to 10
  // Combo + campaign (menu combo feature). productType STANDARD unless this is
  // a combo bundle. On the public menu, `price` is the CHARGED (effective)
  // price and `listPrice` the pre-discount catalog price when a campaign runs.
  productType?: "STANDARD" | "COMBO";
  listPrice?: number;
  campaignActive?: boolean;
  campaignLabel?: string | null;
  campaignPrice?: number | null;
  campaignStartAt?: string | null;
  campaignEndAt?: string | null;
  comboGroups?: ComboGroup[];
  collections?: MenuCollection[]; // admin GET returns [{id,name,slug}]
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

// A combo slot as delivered by the public menu / admin GET.
export interface ComboItem {
  id: string;
  componentProductId: string;
  name?: string;
  image?: string | null;
  quantity: number;
  priceDelta: number;
  isDefault: boolean;
  // admin GET nests the component product
  componentProduct?: { id: string; name: string; price: number; image?: string | null };
}

export interface ComboGroup {
  id: string;
  name: string;
  displayName?: string | null;
  minSelect: number;
  maxSelect: number;
  items: ComboItem[];
}

// Combo builder input (admin create/update product body)
export interface ComboGroupItemInput {
  componentProductId: string;
  quantity?: number;
  priceDelta?: number;
  isDefault?: boolean;
  displayOrder?: number;
}
export interface ComboGroupInput {
  name: string;
  displayName?: string;
  minSelect?: number;
  maxSelect?: number;
  displayOrder?: number;
  items: ComboGroupItemInput[];
}

export interface MenuCollection {
  id: string;
  name: string;
  slug: string;
  displayOrder?: number;
  isActive?: boolean;
  productCount?: number;
  productIds?: string[]; // public menu shape
}

export interface CreateMenuCollectionDto {
  name: string;
  slug?: string;
  displayOrder?: number;
  isActive?: boolean;
}
export interface UpdateMenuCollectionDto extends Partial<CreateMenuCollectionDto> {}

export interface CreateProductDto {
  name: string;
  description?: string;
  ingredients?: string; // customer-facing "içindekiler" (contents)
  price: number;
  image?: string; // Legacy field
  imageIds?: string[]; // New multi-image support
  categoryId: string;
  currentStock?: number;
  stockTracked?: boolean;
  isAvailable?: boolean;
  displayOrder?: number;
  taxRate?: number;
  // Combo + campaign + classification
  productType?: "STANDARD" | "COMBO";
  comboGroups?: ComboGroupInput[];
  campaignPrice?: number | null;
  campaignLabel?: string | null;
  campaignStartAt?: string | null;
  campaignEndAt?: string | null;
  collectionIds?: string[];
}

export interface UpdateProductDto extends Partial<CreateProductDto> {}

// Upload Types
export interface UploadProductImageResponse {
  id: string;
  url: string;
  filename: string;
  size: number;
  mimeType: string;
  tenantId: string;
}

export interface UploadMultipleImagesResponse {
  images: UploadProductImageResponse[];
  count: number;
}

// Table Types
export enum TableStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  RESERVED = 'RESERVED',
}

/** Annotation surfaced on every `Table` row by `GET /tables`:
 *  the next CONFIRMED/PENDING reservation starting within the next
 *  ~2 hours, if any. Lets the floor plan render a badge and the POS
 *  warn before opening a walk-in. `null` when no reservation matches. */
export interface UpcomingReservationOnTable {
  id: string;
  startTime: string; // HH:mm
  endTime: string;
  customerName: string;
  guestCount: number;
  status: string;
  startsAt: string; // ISO datetime; clients can compute "in N minutes"
}

/** Silhouette a table renders as on the 2D floor plan. */
export enum TableShape {
  ROUND = 'ROUND',
  SQUARE = 'SQUARE',
  RECT = 'RECT',
}

export interface Table {
  id: string;
  number: string;
  capacity: number;
  section?: string;
  status: TableStatus;
  groupId?: string | null;
  /** Auto-set by reservation-scheduler when status=RESERVED was a
   *  hold for an upcoming reservation. Null for manually-RESERVED. */
  reservationHoldId?: string | null;
  /** Closest upcoming reservation (next ~2 h) — surfaced by GET /tables. */
  upcomingReservation?: UpcomingReservationOnTable | null;
  // Floor-plan placement (v3.2.45+). zoneId=null ⇒ not yet placed.
  zoneId?: string | null;
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
  rotation?: number;
  shape?: TableShape;
  tenantId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateTableDto {
  number: string;
  capacity: number;
  status?: TableStatus;
  // Optional geometry when a table is created directly onto the canvas.
  zoneId?: string | null;
  posX?: number;
  posY?: number;
  width?: number;
  height?: number;
  rotation?: number;
  shape?: TableShape;
}

export interface UpdateTableDto extends Partial<CreateTableDto> {}

// ----- Floor plan (2D restaurant map) -----

export enum FloorZoneKind {
  INDOOR = 'INDOOR',
  OUTDOOR = 'OUTDOOR',
}

export enum FloorElementType {
  WALL = 'WALL',
  DOOR = 'DOOR',
  BAR = 'BAR',
  KITCHEN = 'KITCHEN',
  PLANT = 'PLANT',
  DECOR = 'DECOR',
  TEXT = 'TEXT',
  RECT = 'RECT',
}

export interface FloorElement {
  id: string;
  zoneId: string;
  type: FloorElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  points?: { x: number; y: number }[] | null;
  style?: Record<string, any> | null;
  label?: string | null;
  zIndex: number;
}

/** A placed table as returned inside the floor plan (geometry-focused;
 *  `tableShape` avoids clashing with any reserved word and mirrors the
 *  backend getPlan shape). */
export interface FloorPlanTable {
  id: string;
  number: string;
  capacity: number;
  status: TableStatus;
  groupId?: string | null;
  zoneId: string | null;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  tableShape: TableShape;
  activeOrderCount: number;
}

export interface FloorZone {
  id: string;
  name: string;
  sortOrder: number;
  kind: FloorZoneKind;
  canvasWidth: number;
  canvasHeight: number;
  gridSize: number;
  backgroundImageUrl?: string | null;
  backgroundOpacity: number;
  elements: FloorElement[];
  tables: FloorPlanTable[];
}

export interface FloorPlan {
  zones: FloorZone[];
  unplacedTables: FloorPlanTable[];
}

export interface CreateFloorZoneDto {
  name: string;
  kind?: FloorZoneKind;
  canvasWidth?: number;
  canvasHeight?: number;
  gridSize?: number;
  backgroundImageUrl?: string;
  backgroundOpacity?: number;
}

export interface UpdateFloorZoneDto extends Partial<CreateFloorZoneDto> {}

export interface CreateFloorElementDto {
  zoneId: string;
  type: FloorElementType;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  points?: { x: number; y: number }[];
  style?: Record<string, any>;
  label?: string;
  zIndex?: number;
}

export interface UpdateFloorElementDto extends Partial<Omit<CreateFloorElementDto, 'zoneId'>> {
  zoneId?: string;
}

/** One table's geometry in a bulk layout save. */
export interface LayoutTableItem {
  id: string;
  zoneId: string | null;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotation: number;
  shape: TableShape;
}

/** One element's geometry in a bulk layout save. */
export interface LayoutElementItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  points?: { x: number; y: number }[];
  style?: Record<string, any>;
}

export interface SaveLayoutDto {
  tables: LayoutTableItem[];
  elements?: LayoutElementItem[];
}

// Table Merge/Split Types
export interface MergeTablesDto {
  tableIds: string[];
}

export interface UnmergeTableDto {
  tableId: string;
}

export interface TableGroupInfo {
  groupId: string;
  tables: { id: string; number: string; capacity: number; section?: string; status: TableStatus }[];
  orders: any[];
  summary: {
    totalOrders: number;
    totalAmount: number;
    totalPaid: number;
    remainingAmount: number;
  };
}

// Bill Split Types
export type SplitType = 'EQUAL' | 'BY_ITEMS' | 'CUSTOM';

export interface SplitPaymentEntry {
  amount: number;
  method: string;
  label?: string;
  orderItemIds?: string[];
}

export interface SplitBillDto {
  splitType: SplitType;
  numberOfParts?: number;
  payments: SplitPaymentEntry[];
  customerPhone?: string;
  /** Batch-level idempotency key auto-filled by useSplitBill. */
  idempotencyKey?: string;
}

export interface GroupBillSummary {
  groupId: string;
  tables: { id: string; number: string }[];
  orders: {
    id: string;
    orderNumber: string;
    tableId: string;
    finalAmount: number;
    paidAmount: number;
  }[];
  items: {
    id: string;
    orderId: string;
    orderNumber: string;
    tableNumber?: string;
    productName?: string;
    quantity: number;
    paidQuantity?: number;
    remainingQuantity?: number;
    unitPrice: number;
    subtotal: number;
    modifiers?: { name?: string; price: number }[];
  }[];
  summary: {
    totalAmount: number;
    totalPaid: number;
    remainingAmount: number;
  };
}

// Progressive ("Dutch-style") payment types
export interface PayItemEntry {
  orderItemId: string;
  quantity: number;
}

export interface PayItemsDto {
  items: PayItemEntry[];
  method: string; // 'CASH' | 'CARD' | 'DIGITAL'
  notes?: string;
  transactionId?: string;
  customerPhone?: string;
  idempotencyKey?: string;
}

export interface PayableItem {
  orderItemId: string;
  productName: string | null;
  quantity: number;
  paidQuantity: number;
  remainingQuantity: number;
  unitPrice: string;
  /** Per-unit value after pro-rata discount (server-rounded, 2dp). */
  unitTotal: string;
  /**
   * Authoritative discount-adjusted line total for all units. Use this
   * (× selectedQty / quantity proportion if needed) for any display
   * total so the UI never drifts from what the server will actually
   * charge on the closing payment.
   */
  itemTotal: string;
  modifierLabels: string[];
}

export interface PayableItemsSummary {
  orderId: string;
  finalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  remainingQuantity: number;
  items: PayableItem[];
  payments: Array<{
    id: string;
    amount: string;
    method: string;
    notes: string | null;
    paidAt: string | null;
    allocations: Array<{ orderItemId: string; quantity: number; amount: string }>;
  }>;
}

export interface PayItemsResponse {
  payment: Payment;
  itemAllocations: Array<{ orderItemId: string; quantity: number; amount: string }>;
  orderFullyPaid: boolean;
  remaining: PayableItemsSummary;
}

export interface PublicTable {
  id: string;
  number: string;
  capacity: number;
  status: TableStatus;
}

// Order Types
export enum OrderStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  PENDING = 'PENDING',
  PREPARING = 'PREPARING',
  READY = 'READY',
  SERVED = 'SERVED',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  product?: Product;
  quantity: number;
  price: number;
  unitPrice?: number; // Product unit price (same as price for backwards compatibility)
  subtotal?: number; // Calculated: (unitPrice + modifierTotal) * quantity
  modifierTotal?: number; // Sum of all modifier price adjustments
  // Combo explosion: a combo is stored as a 0₺ parent + qty-1 children that
  // reference the parent here. Used to re-group a combo back into one cart line
  // when reopening an occupied table.
  parentOrderItemId?: string | null;
  listUnitPrice?: number;
  status?: string; // Item-level status (e.g., PENDING, PREPARING, READY)
  notes: string | null;
  modifiers?: OrderItemModifier[]; // Applied modifiers for this order item
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  tableId: string;
  table?: Table;
  userId: string;
  user?: User;
  type?: OrderType; // Order type: DINE_IN, TAKEAWAY, DELIVERY
  customerName?: string; // Customer name (for non-QR orders)
  customerPhone?: string; // Customer phone (for QR menu orders)
  sessionId?: string; // Customer session ID (for QR menu orders)
  status: OrderStatus;
  requiresApproval?: boolean; // If order requires staff approval (QR orders)
  approvedAt?: string; // When order was approved
  approvedById?: string; // ID of user who approved
  approvedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  }; // User who approved the order
  totalAmount: number;
  discount: number;
  finalAmount: number;
  notes: string | null;
  items: OrderItem[];
  orderItems?: OrderItem[];
  payments?: Payment[];
  source?: string | null; // YEMEKSEPETI, GETIR, TRENDYOL, MIGROS, SEMT (null = internal/POS)
  externalOrderId?: string | null; // Platform's order ID
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export enum OrderType {
  DINE_IN = 'DINE_IN',
  TAKEAWAY = 'TAKEAWAY',
  DELIVERY = 'DELIVERY',
  // Tableless self-pay orders (backend customer-orders flow defaults to
  // COUNTER when no table is involved; Z-reports bucket them separately).
  // Was missing here while the backend wrote it — the kind of drift
  // scripts/check-contract-drift.mjs now guards against.
  COUNTER = 'COUNTER',
}

export enum DeliveryPlatform {
  YEMEKSEPETI = 'YEMEKSEPETI',
  GETIR = 'GETIR',
  TRENDYOL = 'TRENDYOL',
  MIGROS = 'MIGROS',
  SEMT = 'SEMT',
}

export type PlatformAvailability = 'available' | 'coming_soon';

// Mirror of backend/src/modules/delivery-platforms/constants/platform.enum.ts.
// Drift guard: scripts/check-contract-drift.mjs -> "DeliveryPlatform".
// The API never returns availability — it is not a DTO field (main.ts runs
// ValidationPipe({ whitelist: true }), so an undeclared field is dropped
// silently); the UI reads it from this mirror.
export const PLATFORM_AVAILABILITY: Record<string, PlatformAvailability> = {
  YEMEKSEPETI: 'available',
  GETIR: 'available',
  TRENDYOL: 'available',
  MIGROS: 'available',
  SEMT: 'coming_soon',
};

export interface DeliveryPlatformConfig {
  id: string;
  platform: string;
  isEnabled: boolean;
  // SECURITY: the backend strips secrets on every read (stripSensitiveFields)
  // and never serializes credentials/accessToken back to the client. These
  // fields therefore only exist on the write path (create/update payloads) and
  // are NEVER populated on a read — do not rely on them for display logic.
  credentials?: Record<string, any>;
  accessToken?: string;
  // Server-derived presence flags returned in place of the stripped secrets.
  // Use these (not local form state) to decide whether credentials are
  // already configured for a previously-saved platform.
  hasCredentials?: boolean;
  hasAccessToken?: boolean;
  tokenExpiresAt?: string;
  remoteRestaurantId?: string;
  restaurantOpen: boolean;
  lastOrderPollAt?: string;
  lastMenuSyncAt?: string;
  lastError?: string;
  lastErrorAt?: string;
  errorCount: number;
  autoAccept: boolean;
  notifySound?: string;
  // "production" routes to the live platform; "sandbox" routes to the
  // platform's test endpoints and enables the built-in test-order simulator.
  environment?: 'production' | 'sandbox';
  // Branch that receives this platform's orders. null = "first active branch".
  branchId?: string | null;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryPlatformLog {
  id: string;
  platform: string;
  direction: string;
  action: string;
  orderId?: string;
  externalId?: string;
  request?: any;
  response?: any;
  statusCode?: number;
  success: boolean;
  error?: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: string;
  tenantId: string;
  createdAt: string;
}

export interface ComboSelectionInput {
  groupId: string;
  componentProductId: string;
}

export interface CreateOrderItemDto {
  productId: string;
  quantity: number;
  notes?: string;
  comboSelections?: ComboSelectionInput[];
}

export interface CreateOrderDto {
  type: OrderType;
  tableId?: string;
  customerName?: string;
  items: CreateOrderItemDto[];
  notes?: string;
  discount?: number;
  /**
   * Client-generated UUID — same value across retries of the same logical
   * "Send to Kitchen" click so a double-tap or 401-refresh-retry never
   * creates duplicate orders. Backend dedupes by (tenantId, idempotencyKey)
   * via a partial unique index. Optional: legacy callers without one still
   * succeed (just without the dedup guarantee).
   */
  idempotencyKey?: string;
}

export interface UpdateOrderDto {
  discount?: number;
  notes?: string;
  customerName?: string;
  items?: CreateOrderItemDto[];
}

export interface UpdateOrderStatusDto {
  status: OrderStatus;
}

// Payment Types
export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  DIGITAL = 'DIGITAL',
}

// Mirrors backend Prisma Payment.status. The legacy lowercase
// 'paid'/'unpaid' values were never written by the backend
// (PaymentsService writes COMPLETED/FAILED/REFUNDED), so this is a
// pure fix — no live data uses the old values.
export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export interface Payment {
  id: string;
  orderId: string;
  order?: Order;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  transactionId: string | null;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  // Versioned receipt content captured at payment-create time. Backend
  // builds via ReceiptSnapshotBuilder; desktop Tauri app accepts the
  // shape directly via HardwareService.printReceipt. See
  // frontend/src/types/hardware.ts for the ReceiptSnapshot interface
  // and backend/src/modules/orders/services/receipt-snapshot.builder.ts
  // for the producer.
  receiptSnapshot?: import('./hardware').ReceiptSnapshot | null;
}

export interface CreatePaymentDto {
  orderId: string;
  amount: number;
  method: PaymentMethod;
  transactionId?: string;
  customerPhone?: string;
  /**
   * Client-generated UUID for the "Confirm Payment" click. Backend has
   * a partial unique index on (orderId, idempotencyKey) — repeating the
   * same key returns the existing payment row instead of creating a
   * second one. See payments.service.ts:62-78 for the fast-path read
   * and the P2002 catch that handles the concurrent-retry race. The
   * useCreatePayment hook auto-fills it with a fresh UUID per submit;
   * declared here so the cast in ordersApi is no longer needed.
   */
  idempotencyKey?: string;
  notes?: string;
}

export interface UpdatePaymentDto {
  status?: PaymentStatus;
}

// Stock Movement Types
export enum MovementType {
  IN = 'in',
  OUT = 'out',
  ADJUSTMENT = 'adjustment',
}

export interface StockMovement {
  id: string;
  productId: string;
  product?: Product;
  type: MovementType;
  quantity: number;
  reason: string | null;
  userId: string;
  user?: User;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStockMovementDto {
  productId: string;
  type: MovementType;
  quantity: number;
  reason?: string;
}

// Report Types
export interface SalesReportDto {
  startDate: string;
  endDate: string;
  // Restrict to a specific branch. Optional — omitting yields tenant-wide
  // numbers (including pre-Phase-3 orders that have no branchId set).
  branchId?: string;
}

export interface SalesReport {
  totalSales: number;
  totalOrders: number;
  averageOrderValue: number;
  totalDiscount: number;
  paymentMethodBreakdown: {
    method: PaymentMethod;
    total: number;
    count: number;
  }[];
  dailySales: {
    date: string;
    sales: number;
    orders: number;
  }[];
}

export interface TopProduct {
  productId: string;
  productName: string;
  categoryName: string;
  quantitySold: number;
  revenue: number;
}

// QR Menu Types
export interface QRMenuData {
  tenant: Tenant;
  categories: Category[];
  products: Product[];
}

// Filter & Pagination Types
export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginatedMeta;
}

export interface OrderFilters extends PaginationParams {
  status?: OrderStatus | string; // Support both single status and comma-separated statuses
  tableId?: string;
  startDate?: string;
  endDate?: string;
}

export interface ProductFilters extends PaginationParams {
  categoryId?: string;
  isAvailable?: boolean;
  search?: string;
}

// WebSocket Event Types
export interface OrderStatusChangedEvent {
  orderId: string;
  status: OrderStatus;
  updatedAt: string;
}

export interface NewOrderEvent {
  order: Order;
}

export interface TableStatusChangedEvent {
  tableId: string;
  status: TableStatus;
  updatedAt: string;
}

// Licensing types
//
// The product model is "free core + individually purchased annual products":
// no packages, no tiers, no plans to pick and no trial period. What a tenant
// can actually do is decided by the folded entitlement set (see
// `EffectiveFeatures` below), NOT by a plan name.
//
// The enums and shapes here mirror LEGACY billing rows that still exist in the
// database and on the /subscriptions endpoints. Read them; do not build new
// gating on them.
//
// The `SubscriptionPlanType` enum (TRIAL/BASIC/PRO/BUSINESS/FREE) that used to
// live here was deleted: nothing imported it, and its only in-file use was
// typing `Plan.name`, which the backend already serves as a plain string
// (`SubscriptionResponseDto.plan.name`).

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  PAST_DUE = 'PAST_DUE',
  TRIALING = 'TRIALING',
  /** Legacy terminal state of the retired onboarding trial. Nothing enters it
   *  any more and nothing locks on it — the old SubscriptionStatusGuard was
   *  removed when the core became free. Kept because historical rows carry
   *  the value. */
  TRIAL_ENDED = 'TRIAL_ENDED',
  /** Pre-activation state between PayTR intent and webhook confirmation. */
  PENDING = 'PENDING',
}

/** Legacy DB enum. The à-la-carte catalogue is annual-only (`annual` /
 *  `oneTime` on the product row); MONTHLY survives only on historical rows. */
export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum PaymentProvider {
  PAYTR = 'PAYTR',
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  PAID = 'PAID',
  VOID = 'VOID',
  UNCOLLECTIBLE = 'UNCOLLECTIBLE',
}

/** Numeric `limit.*` keys as folded by the entitlement engine. `-1` means
 *  unlimited and DOMINATES the SUM fold. */
export interface PlanLimits {
  /** Unlimited (-1) in the free core. */
  maxUsers: number;
  /** Unlimited (-1) in the free core. */
  maxTables: number;
  /** The one surviving numeric cap: the free core grants 1 branch, and each
   *  purchased `extra_branch` capacity unit SUMs +1 on top. */
  maxBranches: number;
  /** Unlimited (-1) in the free core. */
  maxProducts: number;
  /** Unlimited (-1) in the free core. */
  maxCategories: number;
  /** Unlimited (-1) in the free core. */
  maxMonthlyOrders: number;
  /** Legacy AI quota columns, still mirrored onto this payload from the plan
   *  row. They no longer decide anything: the AI menu studio now runs on
   *  PREPAID CREDITS (one-time credit packs, lifetime balance, read inside the
   *  locked claim transaction — never from the entitlement cache). Read the
   *  credit balance, not these. */
  maxMonthlyAiPhotos: number;
  maxMonthlyAiVideos: number;
  maxMonthlyAi3dModels: number;
}

/**
 * The `feature.*` capability flags as folded by the entitlement engine (OR
 * across every source), NOT a per-plan feature list — there are no plans.
 *
 * A flag is `true` because the free core grants it unconditionally, or because
 * the tenant holds the annual product that grants it. Every paid product also
 * needs the annual HummyTummy licence to be active.
 */
export interface PlanFeatures {
  /** Paid — "Gelişmiş Rapor" module (`advanced_reports`). */
  advancedReports: boolean;
  /** FREE core — the branch hub, picker and switcher. Multi-branch is not the
   *  paid thing; the SECOND branch is (`extra_branch` capacity, which grants
   *  this flag too). */
  multiLocation: boolean;
  /** FREE core — custom brand + own domain. */
  customBranding: boolean;
  /** Paid — "API & Webhook" module (`api_access`). */
  apiAccess: boolean;
  /** Paid — included in the "Bakım, Destek ve Güncelleme" licence (`license_annual`). Formerly the standalone `priority_support` module, archived in v3.6.7. */
  prioritySupport: boolean;
  /** Paid — "Stok & Maliyet" module (`module_inventory`). */
  inventoryTracking: boolean;
  /** FREE core — the kitchen display. */
  kdsIntegration: boolean;
  /** Paid — "Rezervasyon" module (`module_reservations`). */
  reservationSystem: boolean;
  /** Paid — "Personel" module (`module_personnel`). */
  personnelManagement: boolean;
  /** Paid — "Kartlı Vardiya" module (`module_personnel_card_shift`, ₺4.000
   *  one-time). RFID card clock-in; rides ON TOP of personnelManagement, so
   *  both flags must be live for the card surfaces to open. */
  cardShift: boolean;
  /** Paid — set by any delivery-platform integration product (Yemeksepeti,
   *  Getir, Trendyol Yemek). Which vendors are actually connected lives in
   *  `EffectiveFeatures.integrations.delivery`, not here. */
  deliveryIntegration: boolean;
  /** FREE core — the POS / tab screen. `<FeatureGate feature="posAccess">`
   *  still wraps the /pos route, but the free baseline grants this to every
   *  tenant unconditionally, so it passes for everyone. */
  posAccess: boolean;
  /** Paid — "Partner Ekran API" module (`module_external_display`). Lets
   *  third-party apps/screens browse the menu, order, self-pay and watch order
   *  status live via a tenant-issued API key. Gates the
   *  /admin/settings/partner-keys page and the /v1/partner/* + /v1/display/*
   *  backend surface. */
  externalDisplay: boolean;
  /** Paid — "AI Menü Stüdyosu" module (`module_ai_studio`). Opens the panel
   *  and the generate endpoints; what you can actually spend is the prepaid
   *  credit balance, not a monthly quota. */
  aiContentGeneration: boolean;
}

/**
 * A legacy `SubscriptionPlan` row as served by `GET /subscriptions/plans`.
 *
 * RETIRED as a product concept: nothing is sold as a plan any more and no UI
 * offers one. Kept as the response shape for the endpoints that still read
 * these rows. To decide what a tenant may do, read `EffectiveFeatures`.
 */
export interface Plan {
  id: string;
  /** Legacy row identifier (historically TRIAL/BASIC/PRO/BUSINESS/FREE).
   *  A plain string, exactly as the backend serves it — do not branch on it. */
  name: string;
  displayName: string;
  description?: string;
  /** Legacy row pricing. Live pricing is the à-la-carte catalogue: annual
   *  products + one-time items, VAT-inclusive kuruş, TRY only. */
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  /** Legacy column. There is no trial period in the product. */
  trialDays: number;
  limits: PlanLimits;
  features: PlanFeatures;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TenantOverrides {
  featureOverrides: Partial<Record<keyof PlanFeatures, boolean>> | null;
  limitOverrides: Partial<Record<keyof PlanLimits, number>> | null;
  planDefaults: {
    features: PlanFeatures;
    limits: PlanLimits;
  };
  effective: {
    features: PlanFeatures;
    limits: PlanLimits;
  };
}

export interface EffectiveFeatures {
  features: PlanFeatures;
  limits: PlanLimits;
  /**
   * v2.8.88 — integration grants from the entitlement engine. Keys are
   * the domain (delivery, fiscal, caller, …); values are the vendor
   * lists granted by the integration products the tenant holds (e.g.
   * `['yemeksepeti', 'getir']` once both are bought). The frontend reads
   * this map via `useSubscription().hasIntegration(domain, vendor?)`.
   *
   * Optional because brand-new tenants whose projector hasn't run yet
   * may not have any integration row. Treat missing as "no vendors".
   */
  integrations?: Record<string, string[]>;
  /**
   * Legacy field, still computed by the endpoint over the retired plan rows.
   * There is no trial period in the product, so nothing here is claimable —
   * ignore it and never render a badge or offer from it.
   */
  trialEligiblePlanIds?: string[];
}

/**
 * A legacy `Subscription` row. Nothing new lands here: purchases go through
 * the Marketplace checkout rail and are held as products with a single shared
 * anniversary, renewed manually.
 */
export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  paymentProvider: PaymentProvider;
  startDate: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelledAt?: string;
  endedAt?: string;
  /** Legacy columns from the retired trial. Always false / absent on
   *  anything created today. */
  isTrialPeriod: boolean;
  trialStart?: string;
  trialEnd?: string;
  amount: number;
  currency: string;
  cancelAtPeriodEnd: boolean;
  plan?: {
    id: string;
    name: string;
    displayName: string;
    description?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  dueDate?: string;
  paidAt?: string;
  description?: string;
  pdfUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubscriptionDto {
  planId: string;
  billingCycle: BillingCycle;
  /** Legacy field. Collection is PayTR-only and card details never reach this
   *  API, so the backend DTO has no such property and ignores it. */
  paymentMethodId?: string;
}

export interface UpdateSubscriptionDto {
  cancelAtPeriodEnd?: boolean;
}

export interface ChangePlanDto {
  newPlanId: string;
  billingCycle?: BillingCycle;
}

// QR Code & Menu Customization Types
export interface QrMenuSettings {
  id: string;
  tenantId: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  fontFamily: string;
  logoUrl?: string;
  showRestaurantInfo: boolean;
  showPrices: boolean;
  showDescription: boolean;
  showImages: boolean;
  layoutStyle: 'GRID' | 'LIST' | 'COMPACT';
  itemsPerRow: number;
  enableTableQR: boolean;
  tableQRMessage: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateQrSettingsDto {
  primaryColor?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  fontFamily?: string;
  logoUrl?: string;
  showRestaurantInfo?: boolean;
  showPrices?: boolean;
  showDescription?: boolean;
  showImages?: boolean;
  layoutStyle?: 'GRID' | 'LIST' | 'COMPACT';
  itemsPerRow?: number;
  enableTableQR?: boolean;
  tableQRMessage?: string;
}

export interface UpdateQrSettingsDto extends Partial<CreateQrSettingsDto> {}

export interface QrCodeData {
  id: string;
  type: 'TENANT' | 'TABLE';
  url: string;
  qrDataUrl: string;
  label: string;
  tableId?: string;
  tableNumber?: string;
}

// POS Settings Types
export interface PosSettings {
  id: string;
  tenantId: string;
  enableTablelessMode: boolean;
  enableTwoStepCheckout: boolean;
  showProductImages: boolean;
  enableCustomerOrdering: boolean;
  defaultMapView: '2d' | '3d';
  requireServedForDineInPayment: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePosSettingsDto {
  enableTablelessMode?: boolean;
  enableTwoStepCheckout?: boolean;
  showProductImages?: boolean;
  enableCustomerOrdering?: boolean;
  defaultMapView?: '2d' | '3d';
  requireServedForDineInPayment?: boolean;
}

// Modifier Types
export enum SelectionType {
  SINGLE = 'SINGLE',
  MULTIPLE = 'MULTIPLE',
}

export interface Modifier {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  priceAdjustment: number;
  isAvailable: boolean;
  displayOrder: number;
  groupId: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModifierGroup {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  selectionType: SelectionType;
  minSelections: number;
  maxSelections?: number;
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
  tenantId: string;
  modifiers: Modifier[];
  _count?: {
    productMappings: number;
  };
  createdAt: string;
  updatedAt: string;
}

// Modifier DTOs
export interface CreateModifierGroupDto {
  name: string;
  displayName: string;
  description?: string;
  selectionType?: SelectionType;
  minSelections?: number;
  maxSelections?: number;
  isRequired?: boolean;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateModifierGroupDto extends Partial<CreateModifierGroupDto> {}

export interface CreateModifierDto {
  name: string;
  displayName: string;
  description?: string;
  priceAdjustment?: number;
  isAvailable?: boolean;
  displayOrder?: number;
  groupId: string;
}

export interface UpdateModifierDto extends Partial<Omit<CreateModifierDto, 'groupId'>> {}

export interface AssignModifierGroupDto {
  groupId: string;
  displayOrder?: number;
}

export interface AssignModifiersToProductDto {
  modifierGroups: AssignModifierGroupDto[];
}

export interface OrderItemModifier {
  id: string;
  orderItemId: string;
  modifierId: string;
  modifier?: Modifier;
  quantity: number;
  priceAdjustment: number;
  createdAt: string;
}

// Customer Types
export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  phoneVerified: boolean;
  loyaltyPoints: number;
  loyaltyTier: string;
  tags: string[];
  notes?: string;
  referralCode?: string;
  referredBy?: string;
  totalOrders: number;
  totalSpent: number;
  averageOrder: number;
  birthday?: string;
  preferences?: Record<string, any>;
  lastVisit?: string;
  createdAt: string;
  updatedAt: string;
  orders?: Order[]; // Included when fetching single customer with orders
}

export interface CreateCustomerDto {
  name: string;
  email?: string;
  phone?: string;
  birthday?: string;
  tags?: string[];
  notes?: string;
}

export interface UpdateCustomerDto extends Partial<CreateCustomerDto> {}

// Customer Ordering Types
export interface CustomerOrderItemModifier {
  modifierId: string;
  quantity: number;
  priceAdjustment: number;
}

export interface CustomerOrderItem {
  productId: string;
  quantity: number;
  notes?: string;
  modifiers?: CustomerOrderItemModifier[];
  comboSelections?: ComboSelectionInput[];
}

export interface CreateCustomerOrderDto {
  tenantId: string;
  tableId: string;
  sessionId: string;
  customerPhone?: string;
  items: CustomerOrderItem[];
  notes?: string;
}

export interface WaiterRequest {
  id: string;
  tableId: string;
  sessionId: string;
  message?: string;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'COMPLETED';
  acknowledgedAt?: string;
  acknowledgedById?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  table?: Table;
  acknowledgedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

export interface CreateWaiterRequestDto {
  tenantId: string;
  tableId: string;
  sessionId: string;
  message?: string;
}

export interface BillRequest {
  id: string;
  tableId?: string | null;
  sessionId: string;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'COMPLETED';
  acknowledgedAt?: string;
  acknowledgedById?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  table?: Table;
  acknowledgedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

export interface CreateBillRequestDto {
  tenantId: string;
  tableId?: string | null;
  sessionId: string;
}

// Cart Types for Customer Ordering
export interface CartModifier {
  id: string;
  name: string;
  displayName: string;
  priceAdjustment: number;
  quantity: number;
}

export interface CartItem {
  id: string; // Temporary ID for cart management (use crypto.randomUUID())
  product: Product;
  quantity: number;
  notes?: string;
  modifiers: CartModifier[];
  // For a COMBO product: the component chosen per slot (sent as comboSelections).
  comboSelections?: ComboSelectionInput[];
  itemTotal: number; // Calculated: (product.price + sum(modifier.priceAdjustment * modifier.quantity)) * quantity
}

// ========================================
// RESERVATION TYPES
// ========================================

export enum ReservationStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  SEATED = 'SEATED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

export interface Reservation {
  id: string;
  reservationNumber: string;
  date: string;
  startTime: string;
  endTime: string;
  guestCount: number;
  notes?: string;
  status: ReservationStatus;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  adminNotes?: string;
  confirmedAt?: string;
  confirmedById?: string;
  rejectionReason?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  seatedAt?: string;
  completedAt?: string;
  tableId?: string;
  table?: { id: string; number: string; capacity: number; section?: string };
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationSettings {
  id: string;
  tenantId: string;
  isEnabled: boolean;
  requireApproval: boolean;
  timeSlotInterval: number;
  minAdvanceBooking: number;
  maxAdvanceDays: number;
  defaultDuration: number;
  operatingHours?: Record<string, { open: string; close: string; closed: boolean }>;
  maxGuestsPerReservation: number;
  maxReservationsPerSlot?: number;
  bannerImageUrl?: string;
  bannerTitle?: string;
  bannerDescription?: string;
  customMessage?: string;
  allowCancellation: boolean;
  cancellationDeadline: number;
  holdOffsetMinutes: number;
}

export interface CreateReservationDto {
  date: string;
  startTime: string;
  endTime: string;
  guestCount: number;
  customerName: string;
  /** At least one of customerPhone or customerEmail is required —
   *  enforced by the backend @AtLeastOneOf DTO constraint and by the
   *  zod schema in features/reservations/public/schema.ts. */
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
  tableId?: string;
  /** Explicit branch for multi-branch tenants; omitted → oldest-active. */
  branchId?: string;
}

export interface UpdateReservationDto {
  date?: string;
  startTime?: string;
  endTime?: string;
  guestCount?: number;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
  adminNotes?: string;
  tableId?: string;
}

export interface UpdateReservationSettingsDto {
  isEnabled?: boolean;
  requireApproval?: boolean;
  timeSlotInterval?: number;
  minAdvanceBooking?: number;
  maxAdvanceDays?: number;
  defaultDuration?: number;
  operatingHours?: Record<string, { open: string; close: string; closed: boolean }>;
  maxGuestsPerReservation?: number;
  maxReservationsPerSlot?: number;
  bannerImageUrl?: string;
  bannerTitle?: string;
  bannerDescription?: string;
  customMessage?: string;
  allowCancellation?: boolean;
  cancellationDeadline?: number;
  holdOffsetMinutes?: number;
}

export interface AvailableSlot {
  time: string;
  available: boolean;
}

export interface AvailableTable {
  id: string;
  number: string;
  capacity: number;
  section?: string;
}

export interface ReservationStats {
  total: number;
  pending: number;
  confirmed: number;
  seated: number;
  completed: number;
  cancelled: number;
  noShow: number;
  rejected: number;
}

// ========================================
// PERSONNEL MANAGEMENT TYPES
// ========================================

export enum AttendanceStatus {
  CLOCKED_IN = 'CLOCKED_IN',
  ON_BREAK = 'ON_BREAK',
  CLOCKED_OUT = 'CLOCKED_OUT',
}

export enum ShiftAssignmentStatus {
  SCHEDULED = 'SCHEDULED',
  COMPLETED = 'COMPLETED',
  MISSED = 'MISSED',
  SWAPPED = 'SWAPPED',
}

export enum SwapRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface Attendance {
  id: string;
  date: string;
  clockIn: string;
  clockOut?: string;
  breakStart?: string;
  breakEnd?: string;
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  overtimeMinutes: number;
  status: AttendanceStatus | string;
  isLate: boolean;
  lateMinutes: number;
  notes?: string;
  /** manual | card — mirrored by hand from the backend AttendanceSource enum.
   *  Deliberately a plain string, not a union: check-contract-drift.mjs does
   *  not cover this enum, so an unknown value must degrade to the "App" badge
   *  rather than break a type. */
  clockInSource: string;
  clockOutSource?: string;
  shiftAssignmentId?: string;
  shiftAssignment?: ShiftAssignment;
  userId: string;
  user?: { id: string; firstName: string; lastName: string; role: string };
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftTemplate {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  color: string;
  gracePeriodMinutes: number;
  isActive: boolean;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftAssignment {
  id: string;
  date: string;
  status: ShiftAssignmentStatus | string;
  notes?: string;
  userId: string;
  user?: { id: string; firstName: string; lastName: string; role: string };
  shiftTemplateId: string;
  shiftTemplate?: ShiftTemplate;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftSwapRequest {
  id: string;
  status: SwapRequestStatus | string;
  reason?: string;
  requesterId: string;
  requester?: { id: string; firstName: string; lastName: string };
  targetId: string;
  target?: { id: string; firstName: string; lastName: string };
  requesterAssignmentId: string;
  requesterAssignment?: ShiftAssignment;
  targetAssignmentId: string;
  approvedById?: string;
  approvedBy?: { id: string; firstName: string; lastName: string };
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceSummary {
  user: { id: string; firstName: string; lastName: string; role: string };
  totalDays: number;
  totalWorkedMinutes: number;
  totalBreakMinutes: number;
  totalOvertimeMinutes: number;
  lateDays: number;
  totalLateMinutes: number;
  /** How many of totalDays were clocked in with a card. */
  cardClockIns: number;
}

/** One staff member's card enrolment. The API returns the last 4 digits and
 *  nothing else — never the hash, never the ciphertext, never the raw UID. */
export interface CardAssignment {
  userId: string;
  firstName: string;
  lastName: string;
  role: string;
  last4: string | null;
  assignedAt: string | null;
  assignedById: string | null;
}

/** What POST /personnel/attendance/card-tap answers. `ignored` is the 10s
 *  debounce swallowing a reader's duplicate write, not an error. */
export interface CardTapResponse {
  action: 'clockIn' | 'clockOut' | 'breakEnd' | 'ignored';
  user: { id: string; firstName: string; lastName: string; role: string };
  attendance: Attendance | null;
}

export interface PerformanceMetrics {
  user: { id: string; firstName: string; lastName: string; role: string };
  totalOrders: number;
  totalSales: number;
  avgOrderValue: number;
  avgPrepTime: number;
  totalHours: number;
  ordersPerHour: number;
  performanceScore: number;
}

export interface PerformanceTrend {
  month: string;
  label: string;
  totalOrders: number;
  totalSales: number;
  avgOrderValue: number;
  totalHours: number;
  ordersPerHour: number;
}

export interface CreateShiftTemplateDto {
  name: string;
  startTime: string;
  endTime: string;
  color?: string;
  gracePeriodMinutes?: number;
  isActive?: boolean;
}

export interface UpdateShiftTemplateDto extends Partial<CreateShiftTemplateDto> {}

export interface AssignShiftDto {
  userId: string;
  shiftTemplateId: string;
  date: string;
  notes?: string;
}

export interface CreateSwapRequestDto {
  targetId: string;
  requesterAssignmentId: string;
  targetAssignmentId: string;
  reason?: string;
}

// Re-export hardware types
export * from './hardware';
