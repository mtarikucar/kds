import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import {
  ModifierGroup,
  Modifier,
  CreateModifierGroupDto,
  UpdateModifierGroupDto,
  CreateModifierDto,
  UpdateModifierDto,
  AssignModifiersToProductDto,
} from '../../types';

// ========================================
// MODIFIER GROUPS
// ========================================

export const useModifierGroups = (includeInactive = false) => {
  return useQuery({
    queryKey: ['modifier-groups', includeInactive],
    queryFn: async (): Promise<ModifierGroup[]> => {
      const response = await api.get('/modifiers/groups', {
        params: { includeInactive },
      });
      return response.data;
    },
  });
};

export const useModifierGroup = (id: string) => {
  return useQuery({
    queryKey: ['modifier-groups', id],
    queryFn: async (): Promise<ModifierGroup> => {
      const response = await api.get(`/modifiers/groups/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

export const useCreateModifierGroup = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateModifierGroupDto): Promise<ModifierGroup> => {
      const response = await api.post('/modifiers/groups', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifier-groups'] });
      toast.success(i18n.t('common:notifications.modifierGroupCreatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useUpdateModifierGroup = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateModifierGroupDto;
    }): Promise<ModifierGroup> => {
      const response = await api.put(`/modifiers/groups/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifier-groups'] });
      toast.success(i18n.t('common:notifications.modifierGroupUpdatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useDeleteModifierGroup = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/modifiers/groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifier-groups'] });
      toast.success(i18n.t('common:notifications.modifierGroupDeletedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

// ========================================
// MODIFIERS
// ========================================

export const useModifiers = (groupId?: string, includeUnavailable = false) => {
  return useQuery({
    queryKey: ['modifiers', groupId, includeUnavailable],
    queryFn: async (): Promise<Modifier[]> => {
      const response = await api.get('/modifiers', {
        params: { groupId, includeUnavailable },
      });
      return response.data;
    },
  });
};

export const useModifier = (id: string) => {
  return useQuery({
    queryKey: ['modifiers', id],
    queryFn: async (): Promise<Modifier> => {
      const response = await api.get(`/modifiers/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

export const useCreateModifier = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateModifierDto): Promise<Modifier> => {
      const response = await api.post('/modifiers', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifiers'] });
      queryClient.invalidateQueries({ queryKey: ['modifier-groups'] });
      toast.success(i18n.t('common:notifications.modifierCreatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useUpdateModifier = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateModifierDto;
    }): Promise<Modifier> => {
      const response = await api.put(`/modifiers/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifiers'] });
      queryClient.invalidateQueries({ queryKey: ['modifier-groups'] });
      toast.success(i18n.t('common:notifications.modifierUpdatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useDeleteModifier = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/modifiers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifiers'] });
      queryClient.invalidateQueries({ queryKey: ['modifier-groups'] });
      toast.success(i18n.t('common:notifications.modifierDeletedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

// ========================================
// PRODUCT-MODIFIER ASSIGNMENTS
// ========================================

export const useProductModifiers = (productId: string) => {
  return useQuery({
    queryKey: ['product-modifiers', productId],
    queryFn: async (): Promise<ModifierGroup[]> => {
      const response = await api.get(`/modifiers/products/${productId}`);
      return response.data;
    },
    enabled: !!productId,
  });
};

export const useAssignModifiersToProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      productId,
      data,
    }: {
      productId: string;
      data: AssignModifiersToProductDto;
    }): Promise<void> => {
      await api.post(`/modifiers/products/${productId}/assign`, data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['product-modifiers', variables.productId] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(i18n.t('common:notifications.productModifiersUpdatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useRemoveModifierGroupFromProduct = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      productId,
      groupId,
    }: {
      productId: string;
      groupId: string;
    }): Promise<void> => {
      await api.delete(`/modifiers/products/${productId}/groups/${groupId}`);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['product-modifiers', variables.productId] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(i18n.t('common:notifications.modifierGroupRemovedFromProduct'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};
