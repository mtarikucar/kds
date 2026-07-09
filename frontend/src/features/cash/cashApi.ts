import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useBranchScopeStore } from '../../store/branchScopeStore';

export const useCashierSessions = (status?: string) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['cash', 'sessions', status, branchId],
    queryFn: async () => {
      const r = await api.get('/cash-drawer/sessions', { params: { status } });
      return r.data;
    },
  });
};

export const useXReport = (sessionId?: string) => {
  return useQuery({
    queryKey: ['cash', 'x-report', sessionId],
    queryFn: async () => {
      const r = await api.get(`/cash-drawer/sessions/${sessionId}/x-report`);
      return r.data;
    },
    enabled: !!sessionId,
  });
};

export const useCreateCashMovement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      type: string;
      amount: number;
      reason?: string;
    }) => {
      const r = await api.post('/cash-drawer/movements', input);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cash'] }),
  });
};

export const useTipDistribution = (params: {
  startDate?: string;
  endDate?: string;
}) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['cash', 'tip-distribution', params, branchId],
    queryFn: async () => {
      const r = await api.get('/reports/tip-distribution', { params });
      return r.data;
    },
    enabled: !!params.startDate && !!params.endDate,
  });
};

export const useOkcDevice = () => {
  return useQuery({
    queryKey: ['okc', 'device'],
    queryFn: async () => {
      const r = await api.get('/okc/device');
      return r.data;
    },
  });
};

export const usePrintOkcReceipt = () => {
  return useMutation({
    mutationFn: async (orderId: string) => {
      const r = await api.post(`/okc/orders/${orderId}/print`);
      return r.data;
    },
  });
};

export const downloadSessionsCsv = async () => {
  // Z-history = closed sessions only (OPEN rows have empty reconciliation cols).
  const r = await api.get('/cash-drawer/sessions.csv', {
    params: { status: 'CLOSED' },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cashier-sessions.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
