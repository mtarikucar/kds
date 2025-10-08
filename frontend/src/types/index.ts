// User & Auth Types
export enum UserRole {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  WAITER = 'WAITER',
  KITCHEN = 'KITCHEN',
  COURIER = 'COURIER',
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string | null;
  status?: string;
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

// Product Types
export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image: string | null;
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
  image?: string;
  categoryId: string;
  currentStock?: number;
  stockTracked?: boolean;
  isAvailable?: boolean;
}

export interface UpdateProductDto extends Partial<CreateProductDto> {}

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
  status?: OrderStatus;
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
