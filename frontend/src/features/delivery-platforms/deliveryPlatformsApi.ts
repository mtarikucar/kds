import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { getApiErrorMessage } from '../../lib/api-error';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import type { DeliveryPlatformConfig, DeliveryPlatformLog } from '../../types';

const tt = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'settings', ...options });

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
      branchId?: string | null;
      environment?: 'production' | 'sandbox';
    }) => {
      const response = await api.post('/delivery-platforms/configs', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveryPlatformConfigs'] });
      toast.success(tt('onlineOrders.toast.configCreated'));
    },
    onError: (error) => {
      toast.error(
        getApiErrorMessage(error, tt('onlineOrders.toast.configCreateFailed')),
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
      branchId?: string | null;
      environment?: 'production' | 'sandbox';
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
    onError: (error) => {
      toast.error(
        getApiErrorMessage(error, tt('onlineOrders.toast.configUpdateFailed')),
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
    onError: (error) => {
      toast.error(
        getApiErrorMessage(error, tt('onlineOrders.toast.configDeleteFailed')),
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
    onError: (error) => {
      toast.error(
        getApiErrorMessage(error, tt('onlineOrders.toast.connectionTestFailed')),
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
    onError: (error) => {
      toast.error(
        getApiErrorMessage(error, tt('onlineOrders.toast.toggleFailed')),
      );
    },
  });
};

// Fire a synthetic TEST order through the real ingest pipeline. Backend
// refuses unless the platform's environment === "sandbox" — that 400 surfaces
// via getApiErrorMessage so the operator knows to flip the sandbox toggle.
export interface TestOrderResult {
  simulated: boolean;
  orderId: string | null;
  orderNumber: string | null;
  externalOrderId: string | null;
  status: string | null;
}

export const useSendTestOrder = () => {
  const queryClient = useQueryClient();
  return useMutation<TestOrderResult, unknown, string>({
    mutationFn: async (platform: string) => {
      const response = await api.post(
        `/delivery-platforms/test-order/${platform}`,
      );
      return response.data;
    },
    onSuccess: (data) => {
      // The synthetic order lands in the kitchen; refresh the activity log.
      queryClient.invalidateQueries({ queryKey: ['deliveryPlatformLogs'] });
      if (data?.orderNumber) {
        toast.success(
          tt('onlineOrders.toast.testOrderCreated', {
            orderNumber: data.orderNumber,
          }),
        );
      } else {
        toast.success(tt('onlineOrders.toast.testOrderSent'));
      }
    },
    onError: (error) => {
      toast.error(
        getApiErrorMessage(error, tt('onlineOrders.toast.testOrderFailed')),
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (platform: string) => {
      const response = await api.post(
        `/delivery-platforms/menu-sync/${platform}`,
      );
      return response.data;
    },
    onSuccess: () => {
      // Server stamps lastMenuSyncAt; refresh configs so the card shows it.
      queryClient.invalidateQueries({ queryKey: ['deliveryPlatformConfigs'] });
      toast.success(tt('onlineOrders.toast.menuSyncStarted'));
    },
    onError: (error) => {
      toast.error(
        getApiErrorMessage(error, tt('onlineOrders.toast.menuSyncFailed')),
      );
    },
  });
};
