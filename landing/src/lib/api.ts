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
