import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export interface CreateZReportDto {
  reportDate: string;
  cashDrawerOpening: number;
  cashDrawerClosing: number;
  notes?: string;
}

export interface ZReport {
  id: string;
  reportNumber: string;
  reportDate: string;
  status: 'GENERATED' | 'CLOSED';
  totalOrders: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  taxAmount: number;
  cashPayments: number;
  cardPayments: number;
  digitalPayments: number;
  cashDrawerOpening: number;
  cashDrawerClosing: number;
  expectedCash: number;
  cashDifference: number;
  notes?: string;
  topProducts?: Array<{ name: string; quantity: number; revenue: number }>;
  cashMovements?: Array<any>;
  createdAt: string;
  closedAt?: string;
}

export interface ZReportsListResponse {
  data: ZReport[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/**
 * Generate a new Z-Report
 */
export function useGenerateZReport() {
  return useMutation({
    mutationFn: async (data: CreateZReportDto): Promise<ZReport> => {
      const response = await api.post('/z-reports', data);
      return response.data;
    },
  });
}

/**
 * Get all Z-Reports
 */
export function useZReports(params?: {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
}) {
  return useQuery({
    queryKey: ['z-reports', params],
    queryFn: async (): Promise<ZReportsListResponse> => {
      const response = await api.get('/z-reports', { params });
      return response.data;
    },
  });
}

/**
 * Get a specific Z-Report
 */
export function useZReport(id: string) {
  return useQuery({
    queryKey: ['z-report', id],
    queryFn: async (): Promise<ZReport> => {
      const response = await api.get(`/z-reports/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
}

/**
 * Close a Z-Report
 */
export function useCloseZReport() {
  return useMutation({
    mutationFn: async (id: string): Promise<ZReport> => {
      const response = await api.patch(`/z-reports/${id}/close`);
      return response.data;
    },
  });
}

/**
 * Download Z-Report PDF
 */
export function downloadZReportPdf(id: string, reportNumber: string) {
  window.open(`${api.defaults.baseURL}/z-reports/${id}/pdf`, '_blank');
}
