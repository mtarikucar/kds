import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { useBranchScopeStore } from '../../store/branchScopeStore';

export const useMenuEngineering = (params: {
  startDate?: string;
  endDate?: string;
}) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['costing', 'menu-engineering', params, branchId],
    queryFn: async () => {
      const r = await api.get('/reports/menu-engineering', { params });
      return r.data;
    },
    enabled: !!params.startDate && !!params.endDate,
  });
};

export const useUsageVariance = (params: {
  startDate?: string;
  endDate?: string;
}) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['costing', 'usage-variance', params, branchId],
    queryFn: async () => {
      const r = await api.get('/stock-management/dashboard/usage-variance', {
        params,
      });
      return r.data;
    },
  });
};
