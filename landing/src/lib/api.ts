import stats from '@/data/stats.json';

export interface FormattedStats {
  restaurantCount: string;
  orderCount: string;
  totalRevenue: string;
}

// Static stats loaded at build time
export function getStats(): FormattedStats {
  return {
    restaurantCount: stats.restaurantCount,
    orderCount: stats.orderCount,
    totalRevenue: stats.totalRevenue,
  };
}

export interface PlanFromAPI {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
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
  isActive: boolean;
  discountPercentage?: number;
  discountLabel?: string;
  discountStartDate?: string;
  discountEndDate?: string;
  isDiscountActive?: boolean;
}

interface RawPlanFromAPI {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  monthlyPrice: string | number;
  yearlyPrice: string | number;
  currency: string;
  trialDays: number;
  limits: {
    maxUsers: number;
    maxTables: number;
    maxProducts: number;
    maxCategories: number;
    maxMonthlyOrders: number;
  };
  features: {
    advancedReports: boolean;
    multiLocation: boolean;
    customBranding: boolean;
    apiAccess: boolean;
    prioritySupport: boolean;
    inventoryTracking: boolean;
    kdsIntegration: boolean;
    reservationSystem?: boolean;
    personnelManagement?: boolean;
    deliveryIntegration?: boolean;
  };
  discount?: {
    percentage: number;
    label?: string;
    startDate?: string;
    endDate?: string;
  } | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function flattenPlan(raw: RawPlanFromAPI): PlanFromAPI {
  return {
    id: raw.id,
    name: raw.name,
    displayName: raw.displayName,
    description: raw.description,
    monthlyPrice: Number(raw.monthlyPrice),
    yearlyPrice: Number(raw.yearlyPrice),
    currency: raw.currency,
    maxUsers: raw.limits?.maxUsers ?? 0,
    maxTables: raw.limits?.maxTables ?? 0,
    maxProducts: raw.limits?.maxProducts ?? 0,
    maxCategories: raw.limits?.maxCategories ?? 0,
    maxMonthlyOrders: raw.limits?.maxMonthlyOrders ?? 0,
    advancedReports: raw.features?.advancedReports ?? false,
    multiLocation: raw.features?.multiLocation ?? false,
    customBranding: raw.features?.customBranding ?? false,
    apiAccess: raw.features?.apiAccess ?? false,
    prioritySupport: raw.features?.prioritySupport ?? false,
    inventoryTracking: raw.features?.inventoryTracking ?? false,
    kdsIntegration: raw.features?.kdsIntegration ?? true,
    isActive: raw.isActive,
    discountPercentage: raw.discount?.percentage,
    discountLabel: raw.discount?.label,
    discountStartDate: raw.discount?.startDate,
    discountEndDate: raw.discount?.endDate,
    isDiscountActive: raw.discount != null && raw.discount.percentage > 0,
  };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'https://api.hummytummy.com.tr';

export async function getPlans(): Promise<PlanFromAPI[]> {
  try {
    const res = await fetch(`${API_BASE}/api/subscriptions/plans`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const raw: RawPlanFromAPI[] = await res.json();
    return raw.map(flattenPlan);
  } catch {
    return [];
  }
}
