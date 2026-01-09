import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import {
  Plan,
  Subscription,
  Invoice,
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
  ChangePlanDto,
} from '../../types';

// Query Keys
export const subscriptionKeys = {
  all: ['subscriptions'] as const,
  plans: () => [...subscriptionKeys.all, 'plans'] as const,
  current: () => [...subscriptionKeys.all, 'current'] as const,
  detail: (id: string) => [...subscriptionKeys.all, 'detail', id] as const,
  invoices: (id: string) => [...subscriptionKeys.all, 'invoices', id] as const,
  tenantInvoices: () => [...subscriptionKeys.all, 'tenant-invoices'] as const,
  pendingChange: (id: string) => [...subscriptionKeys.all, 'pending-change', id] as const,
};

// Get all available subscription plans
export const useGetPlans = () => {
  return useQuery({
    queryKey: subscriptionKeys.plans(),
    queryFn: async (): Promise<Plan[]> => {
      const response = await api.get('/subscriptions/plans');
      return response.data;
    },
  });
};

// Get current tenant's subscription
export const useGetCurrentSubscription = () => {
  return useQuery({
    queryKey: subscriptionKeys.current(),
    queryFn: async (): Promise<Subscription | null> => {
      try {
        const response = await api.get('/subscriptions/current');
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 404) {
          return null;
        }
        throw error;
      }
    },
  });
};

// Get subscription by ID
export const useGetSubscription = (id: string) => {
  return useQuery({
    queryKey: subscriptionKeys.detail(id),
    queryFn: async (): Promise<Subscription> => {
      const response = await api.get(`/subscriptions/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

// Create a new subscription
export const useCreateSubscription = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateSubscriptionDto): Promise<Subscription> => {
      const response = await api.post('/subscriptions', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
      toast.success(i18n.t('common:notifications.subscriptionCreatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

// Update subscription settings
export const useUpdateSubscription = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateSubscriptionDto;
    }): Promise<Subscription> => {
      const response = await api.patch(`/subscriptions/${id}`, data);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
      toast.success(i18n.t('common:notifications.updatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

// Change subscription plan (upgrade/downgrade)
export const useChangePlan = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: ChangePlanDto;
    }): Promise<any> => {  // Changed to any to handle new response structure
      const response = await api.post(`/subscriptions/${id}/change-plan`, data);
      return response.data;
    },
    onSuccess: (result, variables) => {
      // Don't invalidate queries yet - plan hasn't actually changed
      // Only invalidate after payment or scheduled downgrade

      // Show appropriate message based on response
      if (result.pendingChange) {
        if (result.pendingChange.requiresPayment) {
          toast.info(i18n.t('common:notifications.redirectingToPayment'));
        } else if (result.pendingChange.scheduledFor) {
          const date = new Date(result.pendingChange.scheduledFor).toLocaleDateString();
          toast.success(i18n.t('common:notifications.downgradeScheduled', { date }));
          // For scheduled downgrade, invalidate to show the pending status
          queryClient.invalidateQueries({ queryKey: subscriptionKeys.detail(variables.id) });
          queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
        }
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.changePlanFailed'));
    },
  });
};

// Cancel subscription
export const useCancelSubscription = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      immediate = false,
      reason,
    }: {
      id: string;
      immediate?: boolean;
      reason?: string;
    }): Promise<Subscription> => {
      const response = await api.post(`/subscriptions/${id}/cancel`, { immediate, reason });
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
      toast.success(i18n.t('common:notifications.subscriptionCancelledSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.cancelSubscriptionFailed'));
    },
  });
};

// Reactivate a cancelled subscription
export const useReactivateSubscription = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<Subscription> => {
      const response = await api.post(`/subscriptions/${id}/reactivate`);
      return response.data;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
      toast.success(i18n.t('common:notifications.subscriptionReactivatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.reactivateSubscriptionFailed'));
    },
  });
};

// Get subscription invoices
export const useGetSubscriptionInvoices = (subscriptionId: string) => {
  return useQuery({
    queryKey: subscriptionKeys.invoices(subscriptionId),
    queryFn: async (): Promise<Invoice[]> => {
      const response = await api.get(`/subscriptions/${subscriptionId}/invoices`);
      return response.data;
    },
    enabled: !!subscriptionId,
  });
};

// Get all invoices for current tenant
export const useGetTenantInvoices = () => {
  return useQuery({
    queryKey: subscriptionKeys.tenantInvoices(),
    queryFn: async (): Promise<Invoice[]> => {
      const response = await api.get('/subscriptions/tenant/invoices');
      return response.data;
    },
  });
};

// Pending Plan Change types
export interface PendingPlanChange {
  id: string;
  subscriptionId: string;
  currentPlanId: string;
  newPlanId: string;
  isUpgrade: boolean;
  prorationAmount: number;
  currency: string;
  paymentStatus: 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
  failureReason?: string;
  scheduledFor?: string;
  appliedAt?: string;
  createdAt: string;
  currentPlan?: Plan;
  newPlan?: Plan;
}

// Get pending plan change for a subscription
export const useGetPendingPlanChange = (subscriptionId: string) => {
  return useQuery({
    queryKey: subscriptionKeys.pendingChange(subscriptionId),
    queryFn: async (): Promise<PendingPlanChange | null> => {
      try {
        const response = await api.get(`/subscriptions/${subscriptionId}/pending-change`);
        return response.data;
      } catch (error: any) {
        if (error.response?.status === 404) {
          return null;
        }
        throw error;
      }
    },
    enabled: !!subscriptionId,
  });
};

// Cancel pending plan change
export const useCancelPendingPlanChange = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (subscriptionId: string): Promise<void> => {
      await api.delete(`/subscriptions/${subscriptionId}/pending-change`);
    },
    onSuccess: (_, subscriptionId) => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.pendingChange(subscriptionId) });
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
      toast.success(i18n.t('common:notifications.pendingChangesCancelled'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};
