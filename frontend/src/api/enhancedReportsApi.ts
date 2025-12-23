import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';

// Customer Analytics Types
export interface CustomerTierDistribution {
  tier: string;
  count: number;
}

export interface TopCustomer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  totalOrders: number;
  totalSpent: number;
  loyaltyTier: string;
  loyaltyPoints: number;
  lastVisit?: string;
}

export interface CustomerAnalyticsReport {
  tierDistribution: CustomerTierDistribution[];
  totalCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  topCustomers: TopCustomer[];
  averageLifetimeValue: number;
  totalLoyaltyPoints: number;
  startDate: string;
  endDate: string;
}

// Inventory Types
export interface LowStockItem {
  productId: string;
  productName: string;
  categoryName?: string;
  currentStock: number;
  price: number;
}

export interface StockLevel {
  productId: string;
  productName: string;
  categoryName?: string;
  currentStock: number;
  price: number;
  stockValue: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
}

export interface StockMovement {
  id: string;
  type: 'IN' | 'OUT' | 'ADJUSTMENT';
  quantity: number;
  reason?: string;
  productName: string;
  performedBy: string;
  createdAt: string;
}

export interface InventoryReport {
  totalTrackedProducts: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalStockValue: number;
  lowStockItems: LowStockItem[];
  outOfStockItems: { productId: string; productName: string; categoryName?: string }[];
  stockLevels: StockLevel[];
  recentMovements: StockMovement[];
}

// Staff Performance Types
export interface StaffPerformanceItem {
  userId: string;
  staffName: string;
  role: string;
  totalOrders: number;
  totalSales: number;
  averageOrderValue: number;
}

export interface StaffPerformanceReport {
  staffPerformance: StaffPerformanceItem[];
  summary: {
    totalStaff: number;
    totalOrders: number;
    totalSales: number;
    averageOrdersPerStaff: number;
    averageSalesPerStaff: number;
  };
  startDate: string;
  endDate: string;
}

// Hourly Orders Types
export interface HourlyData {
  hour: number;
  orderCount: number;
  totalSales: number;
}

export interface OrdersByHourReport {
  date: string;
  hourlyData: HourlyData[];
}

// Hooks

export function useCustomerAnalytics(params?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['reports', 'customers', params],
    queryFn: async (): Promise<CustomerAnalyticsReport> => {
      const response = await api.get('/reports/customers', { params });
      return response.data;
    },
  });
}

export function useInventoryReport() {
  return useQuery({
    queryKey: ['reports', 'inventory'],
    queryFn: async (): Promise<InventoryReport> => {
      const response = await api.get('/reports/inventory');
      return response.data;
    },
  });
}

export function useStaffPerformance(params?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: ['reports', 'staff-performance', params],
    queryFn: async (): Promise<StaffPerformanceReport> => {
      const response = await api.get('/reports/staff-performance', { params });
      return response.data;
    },
  });
}

export function useOrdersByHour(date?: string) {
  return useQuery({
    queryKey: ['reports', 'orders-by-hour', date],
    queryFn: async (): Promise<OrdersByHourReport> => {
      const response = await api.get('/reports/orders-by-hour', { params: { date } });
      return response.data;
    },
  });
}
