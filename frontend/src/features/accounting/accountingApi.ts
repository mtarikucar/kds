import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import type { PaginatedResponse } from '../../types';
import { AccountingSettings, SalesInvoice } from './types';

export const useGetAccountingSettings = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<AccountingSettings>({
    queryKey: ['accountingSettings', branchId],
    queryFn: async () => (await api.get('/accounting-settings')).data,
  });
};

export const useUpdateAccountingSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<AccountingSettings>) =>
      (await api.patch('/accounting-settings', data)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accountingSettings'] }),
  });
};

export const useTestAccountingConnection = () =>
  useMutation({
    mutationFn: async () =>
      (await api.post('/accounting-settings/test-connection')).data as { success: boolean; error?: string },
  });

export interface AccountingSyncStatus {
  provider: string;
  autoGenerateInvoice: boolean;
  autoSync: boolean;
  total: number;
  synced: number;
  failed: number;
  pending: number;
  lastSyncedAt: string | null;
}

export const useAccountingSyncStatus = (enabled = true) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<AccountingSyncStatus>({
    queryKey: ['accountingSyncStatus', branchId],
    queryFn: async () => (await api.get('/accounting-settings/sync-status')).data,
    enabled,
    // Light polling so a freshly-synced test order shows up without a reload.
    refetchInterval: 15_000,
  });
};

export const useGetSalesInvoices = (params?: Record<string, any>) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<PaginatedResponse<SalesInvoice>>({
    queryKey: ['salesInvoices', params, branchId],
    queryFn: async () => (await api.get<PaginatedResponse<SalesInvoice>>('/sales-invoices', { params })).data,
  });
};

export const useSyncInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/sales-invoices/${id}/sync`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salesInvoices'] }),
  });
};

export const useCancelInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch(`/sales-invoices/${id}/cancel`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['salesInvoices'] }),
  });
};
