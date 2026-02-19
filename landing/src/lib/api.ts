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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'https://api.hummytummy.com.tr';

export async function getPlans(): Promise<PlanFromAPI[]> {
  try {
    const res = await fetch(`${API_BASE}/subscriptions/plans`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
