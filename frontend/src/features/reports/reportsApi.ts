import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import { SalesReport, TopProduct, SalesReportDto } from '../../types';

export const useSalesReport = (params: SalesReportDto) => {
  return useQuery({
    queryKey: ['reports', 'sales', params],
    queryFn: async (): Promise<SalesReport> => {
      const response = await api.get('/reports/sales', { params });
      return response.data;
    },
    enabled: !!params.startDate && !!params.endDate,
  });
};

export const useTopProducts = (params: SalesReportDto) => {
  return useQuery({
    queryKey: ['reports', 'top-products', params],
    queryFn: async (): Promise<TopProduct[]> => {
      const response = await api.get('/reports/top-products', { params });
      return response.data.products || [];
    },
    enabled: !!params.startDate && !!params.endDate,
  });
};
