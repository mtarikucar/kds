import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

// Platform types
export enum PlatformType {
  TRENDYOL = 'TRENDYOL',
  YEMEKSEPETI = 'YEMEKSEPETI',
  GETIR = 'GETIR',
  MIGROS = 'MIGROS',
  FUUDY = 'FUUDY',
}

export const PlatformLabels: Record<PlatformType, string> = {
  [PlatformType.TRENDYOL]: 'Trendyol Go',
  [PlatformType.YEMEKSEPETI]: 'Yemeksepeti',
  [PlatformType.GETIR]: 'Getir',
  [PlatformType.MIGROS]: 'Migros Hemen',
  [PlatformType.FUUDY]: 'Fuudy',
};

export const PlatformColors: Record<PlatformType, string> = {
  [PlatformType.TRENDYOL]: '#F27A1A',
  [PlatformType.YEMEKSEPETI]: '#FA0050',
  [PlatformType.GETIR]: '#5D3EBC',
  [PlatformType.MIGROS]: '#F27405',
  [PlatformType.FUUDY]: '#FF6B35',
};

// Interfaces
export interface DeliveryPlatform {
  type: PlatformType;
  name: string;
  color: string;
  isConfigured: boolean;
  isEnabled: boolean;
  lastSyncedAt: string | null;
}

export interface PlatformConfig {
  type: PlatformType;
  name: string;
  color: string;
  isConfigured: boolean;
  isEnabled: boolean;
  config: Record<string, any> | null;
  lastSyncedAt: string | null;
  recentLogs: SyncLog[];
  stats: PlatformStats[];
}

export interface SyncLog {
  id: string;
  platformType: string;
  operationType: string;
  direction: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

export interface PlatformStats {
  internalStatus: string;
  _count: number;
}

export interface ProductMapping {
  id: string;
  platformType: string;
  platformProductId: string;
  platformCategoryId: string | null;
  productId: string;
  product: {
    id: string;
    name: string;
    price: number;
    category?: {
      id: string;
      name: string;
    };
  };
  syncPrice: boolean;
  syncAvailability: boolean;
  priceMultiplier: number;
  isEnabled: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

export interface UnmappedProduct {
  id: string;
  name: string;
  price: number;
  category?: {
    id: string;
    name: string;
  };
}

export interface PlatformOrder {
  id: string;
  platformType: string;
  platformOrderId: string;
  platformOrderNumber: string | null;
  orderId: string | null;
  platformStatus: string;
  internalStatus: string;
  customerInfo: Record<string, any>;
  deliveryInfo: Record<string, any>;
  platformTotal: number;
  createdAt: string;
  order?: {
    id: string;
    orderNumber: string;
    status: string;
  };
}

export interface SyncStatus {
  platformType: string;
  isEnabled: boolean;
  isConfigured: boolean;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  syncedProducts: number;
  syncedModifiers: number;
  pendingSync: number;
}

// API Hooks

// List all platforms
export const useGetDeliveryPlatforms = () => {
  return useQuery<{ platforms: DeliveryPlatform[] }>({
    queryKey: ['delivery-platforms'],
    queryFn: async () => {
      const response = await api.get('/admin/integrations/platforms');
      return response.data;
    },
  });
};

// Get specific platform details
export const useGetPlatformConfig = (platformType: PlatformType) => {
  return useQuery<PlatformConfig>({
    queryKey: ['platform-config', platformType],
    queryFn: async () => {
      const response = await api.get(`/admin/integrations/platforms/${platformType}`);
      return response.data;
    },
    enabled: !!platformType,
  });
};

// Configure platform
export const useConfigurePlatform = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ platformType, config }: { platformType: PlatformType; config: Record<string, any> }) => {
      const response = await api.post(`/admin/integrations/platforms/${platformType}/configure`, { config });
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['delivery-platforms'] });
      queryClient.invalidateQueries({ queryKey: ['platform-config', variables.platformType] });
    },
  });
};

// Test platform connection
export const useTestPlatformConnection = () => {
  return useMutation({
    mutationFn: async (platformType: PlatformType) => {
      const response = await api.post(`/admin/integrations/platforms/${platformType}/test`);
      return response.data;
    },
  });
};

// Toggle platform
export const useTogglePlatform = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ platformType, isEnabled }: { platformType: PlatformType; isEnabled: boolean }) => {
      const response = await api.patch(`/admin/integrations/platforms/${platformType}/toggle`, { isEnabled });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery-platforms'] });
    },
  });
};

// Get product mappings
export const useGetProductMappings = (platformType: PlatformType, options?: { isEnabled?: boolean; limit?: number; offset?: number }) => {
  return useQuery<{ mappings: ProductMapping[]; total: number }>({
    queryKey: ['product-mappings', platformType, options],
    queryFn: async () => {
      const response = await api.get(`/admin/integrations/mappings/${platformType}/products`, { params: options });
      return response.data;
    },
    enabled: !!platformType,
  });
};

// Get unmapped products
export const useGetUnmappedProducts = (platformType: PlatformType) => {
  return useQuery<{ products: UnmappedProduct[]; total: number }>({
    queryKey: ['unmapped-products', platformType],
    queryFn: async () => {
      const response = await api.get(`/admin/integrations/mappings/${platformType}/unmapped`);
      return response.data;
    },
    enabled: !!platformType,
  });
};

// Create product mapping
export const useCreateProductMapping = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ platformType, data }: { platformType: PlatformType; data: {
      productId: string;
      platformProductId: string;
      platformCategoryId?: string;
      syncPrice?: boolean;
      syncAvailability?: boolean;
      priceMultiplier?: number;
    }}) => {
      const response = await api.post(`/admin/integrations/mappings/${platformType}/products`, data);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['product-mappings', variables.platformType] });
      queryClient.invalidateQueries({ queryKey: ['unmapped-products', variables.platformType] });
    },
  });
};

// Update product mapping
export const useUpdateProductMapping = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ platformType, id, data }: { platformType: PlatformType; id: string; data: Partial<ProductMapping> }) => {
      const response = await api.patch(`/admin/integrations/mappings/${platformType}/products/${id}`, data);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['product-mappings', variables.platformType] });
    },
  });
};

// Delete product mapping
export const useDeleteProductMapping = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ platformType, id }: { platformType: PlatformType; id: string }) => {
      const response = await api.delete(`/admin/integrations/mappings/${platformType}/products/${id}`);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['product-mappings', variables.platformType] });
      queryClient.invalidateQueries({ queryKey: ['unmapped-products', variables.platformType] });
    },
  });
};

// Get sync status
export const useGetSyncStatus = (platformType: PlatformType) => {
  return useQuery<SyncStatus>({
    queryKey: ['sync-status', platformType],
    queryFn: async () => {
      const response = await api.get(`/admin/integrations/sync/${platformType}/status`);
      return response.data;
    },
    enabled: !!platformType,
  });
};

// Trigger menu sync
export const useTriggerMenuSync = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ platformType, productIds }: { platformType: PlatformType; productIds?: string[] }) => {
      const response = await api.post(`/admin/integrations/sync/${platformType}/menu`, { productIds });
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sync-status', variables.platformType] });
    },
  });
};

// Trigger availability sync
export const useTriggerAvailabilitySync = () => {
  return useMutation({
    mutationFn: async ({ platformType, productIds }: { platformType: PlatformType; productIds?: string[] }) => {
      const response = await api.post(`/admin/integrations/sync/${platformType}/availability`, { productIds });
      return response.data;
    },
  });
};

// Trigger price sync
export const useTriggerPriceSync = () => {
  return useMutation({
    mutationFn: async ({ platformType, productIds }: { platformType: PlatformType; productIds?: string[] }) => {
      const response = await api.post(`/admin/integrations/sync/${platformType}/prices`, { productIds });
      return response.data;
    },
  });
};

// Get/Set restaurant status
export const useGetRestaurantStatus = (platformType: PlatformType) => {
  return useQuery<{ isOpen: boolean; reason?: string }>({
    queryKey: ['restaurant-status', platformType],
    queryFn: async () => {
      const response = await api.get(`/admin/integrations/sync/${platformType}/restaurant-status`);
      return response.data;
    },
    enabled: !!platformType,
  });
};

export const useSetRestaurantStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ platformType, isOpen, closedReason }: { platformType: PlatformType; isOpen: boolean; closedReason?: string }) => {
      const response = await api.post(`/admin/integrations/sync/${platformType}/restaurant-status`, { isOpen, closedReason });
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['restaurant-status', variables.platformType] });
    },
  });
};

// Get platform orders
export const useGetPlatformOrders = (filters?: {
  platformType?: PlatformType;
  status?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}) => {
  return useQuery<{ orders: PlatformOrder[]; total: number }>({
    queryKey: ['platform-orders', filters],
    queryFn: async () => {
      const response = await api.get('/admin/integrations/orders', { params: filters });
      return response.data;
    },
  });
};

// Accept platform order
export const useAcceptPlatformOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, estimatedPrepTime }: { id: string; estimatedPrepTime?: number }) => {
      const response = await api.post(`/admin/integrations/orders/${id}/accept`, { estimatedPrepTime });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-orders'] });
    },
  });
};

// Reject platform order
export const useRejectPlatformOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const response = await api.post(`/admin/integrations/orders/${id}/reject`, { reason });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform-orders'] });
    },
  });
};

// Get integration stats
export const useGetIntegrationStats = () => {
  return useQuery<{
    ordersByPlatform: Array<{ platformType: string; _count: number; _sum: { platformTotal: number } }>;
    ordersByStatus: Array<{ internalStatus: string; _count: number }>;
    todayOrders: number;
  }>({
    queryKey: ['integration-stats'],
    queryFn: async () => {
      const response = await api.get('/admin/integrations/stats');
      return response.data;
    },
  });
};
