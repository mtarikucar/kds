import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSuperAdminAuthStore } from '../../../store/superAdminAuthStore';
import {
  SuperAdminLoginRequest,
  SuperAdminLoginResponse,
  Verify2FARequest,
  Setup2FAResponse,
  DashboardStats,
  GrowthMetrics,
  DashboardAlerts,
  TenantListItem,
  TenantDetail,
  TenantFilter,
  UserListItem,
  UserActivity,
  SubscriptionPlan,
  SubscriptionListItem,
  AuditLog,
  AuditFilter,
  PaginatedResponse,
  TenantOverridesResponse,
  UpdateTenantOverridesDto,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// Create axios instance for SuperAdmin API
const superAdminApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
superAdminApi.interceptors.request.use((config) => {
  const token = useSuperAdminAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for token refresh
superAdminApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = useSuperAdminAuthStore.getState().refreshToken;

      if (refreshToken) {
        try {
          const response = await axios.post(`${API_BASE_URL}/superadmin/auth/refresh`, {
            refreshToken,
          });

          const { accessToken } = response.data;
          useSuperAdminAuthStore.getState().setAccessToken(accessToken);
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return superAdminApi(originalRequest);
        } catch (refreshError) {
          useSuperAdminAuthStore.getState().logout();
          window.location.href = import.meta.env.BASE_URL + 'superadmin/login';
        }
      }
    }

    return Promise.reject(error);
  }
);

// Auth API
export const useSuperAdminLogin = () => {
  const { setTempToken, login } = useSuperAdminAuthStore();

  return useMutation({
    mutationFn: async (data: SuperAdminLoginRequest): Promise<SuperAdminLoginResponse> => {
      const response = await superAdminApi.post('/superadmin/auth/login', data);
      return response.data;
    },
    onSuccess: (data) => {
      if (data.requires2FASetup && data.tempToken) {
        // 2FA needs to be set up first
        setTempToken(data.tempToken, true);
      } else if (data.requiresTwoFactor && data.tempToken) {
        // 2FA verification needed
        setTempToken(data.tempToken, false);
      } else if (data.accessToken && data.refreshToken && data.superAdmin) {
        login(data.superAdmin, data.accessToken, data.refreshToken);
      }
    },
  });
};

export const useVerify2FA = () => {
  const { login } = useSuperAdminAuthStore();

  return useMutation({
    mutationFn: async (data: Verify2FARequest): Promise<SuperAdminLoginResponse> => {
      const response = await superAdminApi.post('/superadmin/auth/verify-2fa', data);
      return response.data;
    },
    onSuccess: (data) => {
      if (data.accessToken && data.refreshToken && data.superAdmin) {
        login(data.superAdmin, data.accessToken, data.refreshToken);
      }
    },
  });
};

export const useSetup2FA = () => {
  return useQuery({
    queryKey: ['superadmin', '2fa', 'setup'],
    queryFn: async (): Promise<Setup2FAResponse> => {
      const response = await superAdminApi.get('/superadmin/auth/2fa/setup');
      return response.data;
    },
    enabled: false,
  });
};

export const useEnable2FA = () => {
  return useMutation({
    mutationFn: async (code: string) => {
      const response = await superAdminApi.post('/superadmin/auth/2fa/enable', { code });
      return response.data;
    },
  });
};

export const useSetup2FAWithToken = () => {
  return useMutation({
    mutationFn: async (tempToken: string): Promise<Setup2FAResponse> => {
      const response = await superAdminApi.post('/superadmin/auth/2fa/setup-with-token', { tempToken });
      return response.data;
    },
  });
};

export const useEnable2FAWithToken = () => {
  const { login } = useSuperAdminAuthStore();

  return useMutation({
    mutationFn: async (data: { tempToken: string; code: string }): Promise<SuperAdminLoginResponse> => {
      const response = await superAdminApi.post('/superadmin/auth/2fa/enable-with-token', data);
      return response.data;
    },
    onSuccess: (data) => {
      if (data.accessToken && data.refreshToken && data.superAdmin) {
        login(data.superAdmin, data.accessToken, data.refreshToken);
      }
    },
  });
};

export const useSuperAdminLogout = () => {
  const { logout } = useSuperAdminAuthStore();

  return useMutation({
    mutationFn: async () => {
      const response = await superAdminApi.post('/superadmin/auth/logout');
      return response.data;
    },
    onSuccess: () => {
      logout();
    },
  });
};

// Dashboard API
export const useDashboardStats = () => {
  return useQuery({
    queryKey: ['superadmin', 'dashboard', 'stats'],
    queryFn: async (): Promise<DashboardStats> => {
      const response = await superAdminApi.get('/superadmin/dashboard/stats');
      return response.data;
    },
  });
};

export const useGrowthMetrics = () => {
  return useQuery({
    queryKey: ['superadmin', 'dashboard', 'growth'],
    queryFn: async (): Promise<GrowthMetrics> => {
      const response = await superAdminApi.get('/superadmin/dashboard/growth');
      return response.data;
    },
  });
};

export const useDashboardAlerts = () => {
  return useQuery({
    queryKey: ['superadmin', 'dashboard', 'alerts'],
    queryFn: async (): Promise<DashboardAlerts> => {
      const response = await superAdminApi.get('/superadmin/dashboard/alerts');
      return response.data;
    },
  });
};

export const usePlanDistribution = () => {
  return useQuery({
    queryKey: ['superadmin', 'dashboard', 'plans'],
    queryFn: async () => {
      const response = await superAdminApi.get('/superadmin/dashboard/plans');
      return response.data;
    },
  });
};

export const useRecentActivity = (limit: number = 10) => {
  return useQuery({
    queryKey: ['superadmin', 'dashboard', 'recent', limit],
    queryFn: async () => {
      const response = await superAdminApi.get('/superadmin/dashboard/recent', {
        params: { limit },
      });
      return response.data;
    },
  });
};

// Tenants API
export const useTenants = (filters: TenantFilter = {}) => {
  return useQuery({
    queryKey: ['superadmin', 'tenants', filters],
    queryFn: async (): Promise<PaginatedResponse<TenantListItem>> => {
      const response = await superAdminApi.get('/superadmin/tenants', { params: filters });
      return response.data;
    },
  });
};

export const useTenant = (id: string) => {
  return useQuery({
    queryKey: ['superadmin', 'tenants', id],
    queryFn: async (): Promise<TenantDetail> => {
      const response = await superAdminApi.get(`/superadmin/tenants/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

export const useUpdateTenantStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: string; reason?: string }) => {
      const response = await superAdminApi.patch(`/superadmin/tenants/${id}/status`, { status, reason });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'tenants'] });
    },
  });
};

export const useTenantUsers = (tenantId: string, page: number = 1, limit: number = 20) => {
  return useQuery({
    queryKey: ['superadmin', 'tenants', tenantId, 'users', page, limit],
    queryFn: async () => {
      const response = await superAdminApi.get(`/superadmin/tenants/${tenantId}/users`, {
        params: { page, limit },
      });
      return response.data;
    },
    enabled: !!tenantId,
  });
};

export const useTenantOrders = (tenantId: string, page: number = 1, limit: number = 20) => {
  return useQuery({
    queryKey: ['superadmin', 'tenants', tenantId, 'orders', page, limit],
    queryFn: async () => {
      const response = await superAdminApi.get(`/superadmin/tenants/${tenantId}/orders`, {
        params: { page, limit },
      });
      return response.data;
    },
    enabled: !!tenantId,
  });
};

export const useTenantStats = (tenantId: string) => {
  return useQuery({
    queryKey: ['superadmin', 'tenants', tenantId, 'stats'],
    queryFn: async () => {
      const response = await superAdminApi.get(`/superadmin/tenants/${tenantId}/stats`);
      return response.data;
    },
    enabled: !!tenantId,
  });
};

// Tenant Overrides API
export const useTenantOverrides = (tenantId: string) => {
  return useQuery({
    queryKey: ['superadmin', 'tenants', tenantId, 'overrides'],
    queryFn: async (): Promise<TenantOverridesResponse> => {
      const response = await superAdminApi.get(`/superadmin/tenants/${tenantId}/overrides`);
      return response.data;
    },
    enabled: !!tenantId,
  });
};

export const useUpdateTenantOverrides = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ tenantId, data }: { tenantId: string; data: UpdateTenantOverridesDto }) => {
      const response = await superAdminApi.patch(`/superadmin/tenants/${tenantId}/overrides`, data);
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'tenants', variables.tenantId, 'overrides'] });
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'tenants', variables.tenantId] });
    },
  });
};

export const useResetTenantOverrides = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tenantId: string) => {
      const response = await superAdminApi.delete(`/superadmin/tenants/${tenantId}/overrides`);
      return response.data;
    },
    onSuccess: (_, tenantId) => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'tenants', tenantId, 'overrides'] });
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'tenants', tenantId] });
    },
  });
};

// Users API
export const useAllUsers = (filters: { search?: string; role?: string; tenantId?: string; status?: string; page?: number; limit?: number } = {}) => {
  return useQuery({
    queryKey: ['superadmin', 'users', filters],
    queryFn: async (): Promise<PaginatedResponse<UserListItem>> => {
      const response = await superAdminApi.get('/superadmin/users', { params: filters });
      return response.data;
    },
  });
};

export const useUserActivity = (filters: { userId?: string; tenantId?: string; action?: string; page?: number; limit?: number } = {}) => {
  return useQuery({
    queryKey: ['superadmin', 'users', 'activity', filters],
    queryFn: async (): Promise<PaginatedResponse<UserActivity>> => {
      const response = await superAdminApi.get('/superadmin/users/activity', { params: filters });
      return response.data;
    },
  });
};

// Plans API
export const usePlans = () => {
  return useQuery({
    queryKey: ['superadmin', 'plans'],
    queryFn: async (): Promise<SubscriptionPlan[]> => {
      const response = await superAdminApi.get('/superadmin/plans');
      return response.data;
    },
  });
};

export const useCreatePlan = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<SubscriptionPlan>) => {
      const response = await superAdminApi.post('/superadmin/plans', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'plans'] });
    },
  });
};

export const useUpdatePlan = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<SubscriptionPlan>) => {
      const response = await superAdminApi.patch(`/superadmin/plans/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'plans'] });
    },
  });
};

export const useDeletePlan = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await superAdminApi.delete(`/superadmin/plans/${id}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'plans'] });
    },
  });
};

// Subscriptions API
export const useSubscriptions = (filters: { status?: string; planId?: string; tenantId?: string; page?: number; limit?: number } = {}) => {
  return useQuery({
    queryKey: ['superadmin', 'subscriptions', filters],
    queryFn: async (): Promise<PaginatedResponse<SubscriptionListItem>> => {
      const response = await superAdminApi.get('/superadmin/subscriptions', { params: filters });
      return response.data;
    },
  });
};

export const useExtendSubscription = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, days, reason }: { id: string; days: number; reason?: string }) => {
      const response = await superAdminApi.post(`/superadmin/subscriptions/${id}/extend`, { days, reason });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'subscriptions'] });
    },
  });
};

export const useCancelSubscription = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const response = await superAdminApi.post(`/superadmin/subscriptions/${id}/cancel`, { reason });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'subscriptions'] });
    },
  });
};

export const useChangeSubscriptionPlan = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ subscriptionId, planId }: { subscriptionId: string; planId: string }) => {
      const response = await superAdminApi.patch(`/superadmin/subscriptions/${subscriptionId}`, { planId });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['superadmin', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    },
  });
};

// Audit API
export const useAuditLogs = (filters: AuditFilter = {}) => {
  return useQuery({
    queryKey: ['superadmin', 'audit', filters],
    queryFn: async (): Promise<PaginatedResponse<AuditLog>> => {
      const response = await superAdminApi.get('/superadmin/audit-logs', { params: filters });
      return response.data;
    },
  });
};

export const useExportAuditLogs = () => {
  return useMutation({
    mutationFn: async (filters: AuditFilter & { format?: 'csv' | 'json' }) => {
      const response = await superAdminApi.get('/superadmin/audit-logs/export', {
        params: filters,
        responseType: 'blob',
      });
      return response.data;
    },
  });
};
