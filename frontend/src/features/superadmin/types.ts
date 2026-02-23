// SuperAdmin Types
export interface SuperAdmin {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  twoFactorEnabled: boolean;
}

export interface SuperAdminLoginRequest {
  email: string;
  password: string;
}

export interface SuperAdminLoginResponse {
  requiresTwoFactor: boolean;
  requires2FASetup?: boolean;
  tempToken?: string;
  accessToken?: string;
  refreshToken?: string;
  superAdmin?: SuperAdmin;
}

export interface Verify2FARequest {
  tempToken: string;
  code: string;
}

export interface Setup2FAResponse {
  secret: string;
  qrCodeUrl: string;
  otpauthUrl: string;
}

// Dashboard Types
export interface DashboardStats {
  tenants: {
    total: number;
    active: number;
    suspended: number;
  };
  users: {
    total: number;
  };
  orders: {
    total: number;
  };
  subscriptions: {
    total: number;
    active: number;
    trial: number;
  };
  revenue: {
    mrr: number;
  };
}

export interface GrowthMetrics {
  tenants: { current: number; previous: number; growth: number };
  users: { current: number; previous: number; growth: number };
  orders: { current: number; previous: number; growth: number };
}

export interface DashboardAlerts {
  expiringTrials: number;
  suspendedTenants: number;
  failedPayments: number;
}

// Tenant Types
export interface TenantListItem {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  createdAt: string;
  currentPlan?: {
    id: string;
    name: string;
    displayName: string;
  };
  _count: {
    users: number;
    orders: number;
    tables: number;
    products: number;
    categories?: number;
    customers?: number;
  };
}

export interface TenantDetail extends TenantListItem {
  email?: string;
  phone?: string;
  currency: string;
  paymentRegion: string;
  featureOverrides?: Record<string, boolean> | null;
  limitOverrides?: Record<string, number> | null;
  subscriptions: any[];
  stats: {
    totalRevenue: number;
    ordersToday: number;
    ordersThisMonth: number;
  };
}

export interface TenantOverridesResponse {
  featureOverrides: Record<string, boolean> | null;
  limitOverrides: Record<string, number> | null;
  planDefaults: {
    features: Record<string, boolean>;
    limits: Record<string, number>;
  };
  effective: {
    features: Record<string, boolean>;
    limits: Record<string, number>;
  };
}

export interface UpdateTenantOverridesDto {
  featureOverrides?: Record<string, boolean | null>;
  limitOverrides?: Record<string, number | null>;
}

export interface TenantFilter {
  search?: string;
  status?: string;
  planId?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// User Types
export interface UserListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  lastLogin?: string;
  createdAt: string;
  tenant?: {
    id: string;
    name: string;
  };
}

export interface UserActivity {
  id: string;
  userId: string;
  tenantId: string;
  action: string;
  ip?: string;
  userAgent?: string;
  createdAt: string;
  user?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
  tenant?: {
    id: string;
    name: string;
  };
}

// Subscription & Plan Types
export interface SubscriptionPlan {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  trialDays: number;
  maxUsers: number;
  maxTables: number;
  maxProducts: number;
  maxCategories: number;
  maxMonthlyOrders: number;
  advancedReports: boolean;
  multiLocation: boolean;
  customBranding: boolean;
  apiAccess: boolean;
  prioritySupport: boolean;
  inventoryTracking: boolean;
  kdsIntegration: boolean;
  reservationSystem: boolean;
  isActive: boolean;
  discountPercentage?: number;
  discountLabel?: string;
  discountStartDate?: string;
  discountEndDate?: string;
  isDiscountActive?: boolean;
  _count?: {
    subscriptions: number;
  };
}

export interface SubscriptionListItem {
  id: string;
  status: string;
  billingCycle: string;
  amount: number;
  currentPeriodEnd: string;
  createdAt: string;
  tenant: {
    id: string;
    name: string;
    subdomain: string;
  };
  plan: {
    id: string;
    name: string;
    displayName: string;
  };
}

// Audit Types
export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId?: string;
  actorId: string;
  actorEmail: string;
  previousData?: any;
  newData?: any;
  metadata?: any;
  targetTenantId?: string;
  targetTenantName?: string;
  createdAt: string;
}

export interface AuditFilter {
  action?: string;
  entityType?: string;
  actorId?: string;
  targetTenantId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

// Pagination
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
