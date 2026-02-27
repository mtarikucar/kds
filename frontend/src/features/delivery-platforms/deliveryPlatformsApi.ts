import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import type { DeliveryPlatformConfig, DeliveryPlatformLog } from '../../types';

const tt = (key: string) => i18n.t(key, { ns: 'settings' });

// ========================================
// Platform Configuration Queries
// ========================================

export const useDeliveryPlatformConfigs = () => {
  return useQuery<DeliveryPlatformConfig[]>({
    queryKey: ['deliveryPlatformConfigs'],
    queryFn: async () => {
      const response = await api.get('/delivery-platforms/configs');
      return response.data;
    },
  });
};

export const useDeliveryPlatformConfig = (platform: string) => {
  return useQuery<DeliveryPlatformConfig>({
    queryKey: ['deliveryPlatformConfigs', platform],
    queryFn: async () => {
      const response = await api.get(`/delivery-platforms/configs/${platform}`);
      return response.data;
    },
    enabled: !!platform,
  });
};

// ========================================
// Platform Configuration Mutations
// ========================================

export const useCreatePlatformConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      platform: string;
      credentials?: Record<string, any>;
      remoteRestaurantId?: string;
      autoAccept?: boolean;
    }) => {
      const response = await api.post('/delivery-platforms/configs', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveryPlatformConfigs'] });
      toast.success(tt('onlineOrders.toast.configCreated'));
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.message || tt('onlineOrders.toast.configCreateFailed'),
      );
    },
  });
};

export const useUpdatePlatformConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      platform,
      ...data
    }: {
      platform: string;
      isEnabled?: boolean;
      credentials?: Record<string, any>;
      remoteRestaurantId?: string;
      autoAccept?: boolean;
      notifySound?: string;
    }) => {
      const response = await api.patch(
        `/delivery-platforms/configs/${platform}`,
        data,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveryPlatformConfigs'] });
      toast.success(tt('onlineOrders.toast.configUpdated'));
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.message || tt('onlineOrders.toast.configUpdateFailed'),
      );
    },
  });
};

export const useDeletePlatformConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (platform: string) => {
      const response = await api.delete(
        `/delivery-platforms/configs/${platform}`,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveryPlatformConfigs'] });
      toast.success(tt('onlineOrders.toast.configDeleted'));
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.message || tt('onlineOrders.toast.configDeleteFailed'),
      );
    },
  });
};

// ========================================
// Platform Actions
// ========================================

export const useTestPlatformConnection = () => {
  return useMutation({
    mutationFn: async (platform: string) => {
      const response = await api.post(
        `/delivery-platforms/configs/${platform}/test`,
      );
      return response.data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(tt('onlineOrders.toast.connectionSuccess'));
      } else {
        toast.error(tt('onlineOrders.toast.connectionFailed'));
      }
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.message || tt('onlineOrders.toast.connectionTestFailed'),
      );
    },
  });
};

export const useToggleRestaurant = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      platform,
      open,
    }: {
      platform: string;
      open: boolean;
    }) => {
      const response = await api.post(
        `/delivery-platforms/configs/${platform}/toggle-restaurant`,
        { open },
      );
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['deliveryPlatformConfigs'] });
      toast.success(
        variables.open ? tt('onlineOrders.toast.restaurantOpened') : tt('onlineOrders.toast.restaurantClosed'),
      );
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.message || tt('onlineOrders.toast.toggleFailed'),
      );
    },
  });
};

// ========================================
// Logs
// ========================================

export const useDeliveryPlatformLogs = (params?: {
  platform?: string;
  success?: boolean;
  limit?: number;
  offset?: number;
}) => {
  return useQuery<{ logs: DeliveryPlatformLog[]; total: number }>({
    queryKey: ['deliveryPlatformLogs', params],
    queryFn: async () => {
      const response = await api.get('/delivery-platforms/logs', { params });
      return response.data;
    },
  });
};

// ========================================
// Menu Sync
// ========================================

export const useSyncMenu = () => {
  return useMutation({
    mutationFn: async (platform: string) => {
      const response = await api.post(
        `/delivery-platforms/menu-sync/${platform}`,
      );
      return response.data;
    },
    onSuccess: () => {
      toast.success(tt('onlineOrders.toast.menuSyncStarted'));
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.message || tt('onlineOrders.toast.menuSyncFailed'),
      );
    },
  });
};
