import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

export enum IntegrationType {
  PAYMENT_GATEWAY = 'PAYMENT_GATEWAY',
  POS_HARDWARE = 'POS_HARDWARE',
  THIRD_PARTY_API = 'THIRD_PARTY_API',
  DELIVERY_APP = 'DELIVERY_APP',
  ACCOUNTING = 'ACCOUNTING',
  CRM = 'CRM',
  INVENTORY = 'INVENTORY',
}

export interface Integration {
  id: string;
  tenantId: string;
  integrationType: IntegrationType;
  provider: string;
  name: string;
  config: Record<string, any>;
  isEnabled: boolean;
  isConfigured: boolean;
  lastSyncedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIntegrationDto {
  integrationType: IntegrationType;
  provider: string;
  name: string;
  config: Record<string, any>;
  isEnabled?: boolean;
  notes?: string;
}

export interface UpdateIntegrationDto {
  integrationType?: IntegrationType;
  provider?: string;
  name?: string;
  config?: Record<string, any>;
  isEnabled?: boolean;
  notes?: string;
}

// Get all integrations
export const useGetIntegrations = (type?: string) => {
  return useQuery<Integration[]>({
    queryKey: ['integrations', type],
    queryFn: async () => {
      const params = type ? { type } : undefined;
      const response = await api.get('/admin/settings/integrations', { params });
      return response.data;
    },
  });
};

// Get integration by ID
export const useGetIntegration = (id: string) => {
  return useQuery<Integration>({
    queryKey: ['integration', id],
    queryFn: async () => {
      const response = await api.get(`/admin/settings/integrations/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

// Create integration
export const useCreateIntegration = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateIntegrationDto) => {
      const response = await api.post('/admin/settings/integrations', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
};

// Update integration
export const useUpdateIntegration = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateIntegrationDto }) => {
      const response = await api.patch(`/admin/settings/integrations/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
};

// Delete integration
export const useDeleteIntegration = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.delete(`/admin/settings/integrations/${id}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
};

// Toggle integration status
export const useToggleIntegration = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, isEnabled }: { id: string; isEnabled: boolean }) => {
      const response = await api.patch(`/admin/settings/integrations/${id}/toggle`, {
        isEnabled,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
};

// Update last sync
export const useSyncIntegration = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/admin/settings/integrations/${id}/sync`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
};
