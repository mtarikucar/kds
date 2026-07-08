import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import { SalesReport, TopProduct, SalesReportDto } from '../../types';

export const useSalesReport = (params: SalesReportDto) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['reports', 'sales', params, branchId],
    queryFn: async (): Promise<SalesReport> => {
      const response = await api.get('/reports/sales', { params });
      return response.data;
    },
    enabled: !!params.startDate && !!params.endDate,
  });
};

export const useTopProducts = (params: SalesReportDto) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['reports', 'top-products', params, branchId],
    queryFn: async (): Promise<TopProduct[]> => {
      const response = await api.get('/reports/top-products', { params });
      return response.data.products || [];
    },
    enabled: !!params.startDate && !!params.endDate,
  });
};

// ── Back-office financial reports (P&L, labor, forecast, consolidated) ──────
interface RangeParams { startDate?: string; endDate?: string }

export const useProfitAndLoss = (params: RangeParams) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['reports', 'pnl', params, branchId],
    queryFn: async () => {
      const response = await api.get('/reports/profit-and-loss', { params });
      return response.data;
    },
    enabled: !!params.startDate && !!params.endDate,
  });
};

export const useLaborReport = (params: RangeParams) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['reports', 'labor', params, branchId],
    queryFn: async () => {
      const response = await api.get('/reports/labor', { params });
      return response.data;
    },
    enabled: !!params.startDate && !!params.endDate,
  });
};

export const useSalesForecast = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['reports', 'sales-forecast', branchId],
    queryFn: async () => {
      const response = await api.get('/reports/sales-forecast');
      return response.data;
    },
  });
};

export const useConsolidatedPnl = (params: RangeParams) => {
  return useQuery({
    queryKey: ['reports', 'consolidated-pnl', params],
    queryFn: async () => {
      const response = await api.get('/reports/consolidated-pnl', { params });
      return response.data;
    },
    enabled: !!params.startDate && !!params.endDate,
  });
};
