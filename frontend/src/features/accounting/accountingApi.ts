import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import type { PaginatedResponse } from '../../types';
import { AccountingSettings, SalesInvoice } from './types';

export const useGetAccountingSettings = () =>
  useQuery<AccountingSettings>({
    queryKey: ['accountingSettings'],
    queryFn: async () => (await api.get('/accounting-settings')).data,
  });

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

export const useGetSalesInvoices = (params?: Record<string, any>) =>
  useQuery<PaginatedResponse<SalesInvoice>>({
    queryKey: ['salesInvoices', params],
    queryFn: async () => (await api.get<PaginatedResponse<SalesInvoice>>('/sales-invoices', { params })).data,
  });

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
