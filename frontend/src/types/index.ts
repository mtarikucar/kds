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
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string | null;
  status?: UserStatus | string;
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
  role?: UserRole;
  restaurantName?: string;
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
  price: number;
  image: string | null; // Legacy field, kept for backwards compatibility
  images?: ProductImage[]; // New multi-image support
  categoryId: string;
  category?: Category;
  currentStock: number;
  stockTracked: boolean;
  isAvailable: boolean;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductDto {
  name: string;
  description?: string;
  price: number;
  image?: string; // Legacy field
  imageIds?: string[]; // New multi-image support
  categoryId: string;
  currentStock?: number;
  stockTracked?: boolean;
  isAvailable?: boolean;
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

export interface Table {
  id: string;
  number: string;
  capacity: number;
  section?: string;
  status: string;
  tenantId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateTableDto {
  number: string;
  capacity: number;
  status?: TableStatus;
}

export interface UpdateTableDto extends Partial<CreateTableDto> {}

// Order Types
export enum OrderStatus {
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
  notes: string | null;
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
  status: OrderStatus;
  totalAmount: number;
  discount: number;
  finalAmount: number;
  notes: string | null;
  items: OrderItem[];
  orderItems?: OrderItem[];
  payments?: Payment[];
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export enum OrderType {
  DINE_IN = 'DINE_IN',
  TAKEAWAY = 'TAKEAWAY',
  DELIVERY = 'DELIVERY',
}

export interface CreateOrderItemDto {
  productId: string;
  quantity: number;
  unitPrice: number;
  notes?: string;
}

export interface CreateOrderDto {
  type: OrderType;
  tableId?: string;
  customerName?: string;
  items: CreateOrderItemDto[];
  notes?: string;
  discount?: number;
}

export interface UpdateOrderDto {
  status?: OrderStatus;
  discount?: number;
  notes?: string;
}

// Payment Types
export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  DIGITAL = 'DIGITAL',
}

export enum PaymentStatus {
  PAID = 'paid',
  UNPAID = 'unpaid',
  REFUNDED = 'refunded',
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
}

export interface CreatePaymentDto {
  orderId: string;
  amount: number;
  method: PaymentMethod;
  transactionId?: string;
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

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
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

// Subscription Types
export enum SubscriptionPlanType {
  FREE = 'FREE',
  BASIC = 'BASIC',
  PRO = 'PRO',
  BUSINESS = 'BUSINESS',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  PAST_DUE = 'PAST_DUE',
  TRIALING = 'TRIALING',
}

export enum BillingCycle {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum PaymentProvider {
  STRIPE = 'STRIPE',
  IYZICO = 'IYZICO',
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  PAID = 'PAID',
  VOID = 'VOID',
  UNCOLLECTIBLE = 'UNCOLLECTIBLE',
}

export interface PlanLimits {
  maxUsers: number;
  maxTables: number;
  maxProducts: number;
  maxCategories: number;
  maxMonthlyOrders: number;
}

export interface PlanFeatures {
  advancedReports: boolean;
  multiLocation: boolean;
  customBranding: boolean;
  apiAccess: boolean;
  prioritySupport: boolean;
  inventoryTracking: boolean;
  kdsIntegration: boolean;
}

export interface Plan {
  id: string;
  name: SubscriptionPlanType;
  displayName: string;
  description?: string;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  trialDays: number;
  limits: PlanLimits;
  features: PlanFeatures;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

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
  isTrialPeriod: boolean;
  trialStart?: string;
  trialEnd?: string;
  amount: number;
  currency: string;
  autoRenew: boolean;
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
  paymentMethodId?: string; // Optional: For Stripe payment method
  iyzicoPaymentDetails?: any; // Optional: For Iyzico specific payment details
}

export interface UpdateSubscriptionDto {
  autoRenew?: boolean;
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
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePosSettingsDto {
  enableTablelessMode?: boolean;
  enableTwoStepCheckout?: boolean;
}
