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
  totalOrders: number;
  totalSales: number;
  totalDiscount: number;
  netSales: number;
  cashPayments: number;
  cardPayments: number;
  digitalPayments: number;
  openingCash: number;
  countedCash: number;
  expectedCash: number;
  cashDifference: number;
  pdfExported: boolean;
  notes?: string;
  topProducts?: Array<{ name: string; quantity: number; revenue: number }>;
  staffPerformance?: Array<any>;
  createdAt: string;
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
export async function downloadZReportPdf(id: string, reportNumber: string) {
  const response = await api.get(`/z-reports/${id}/pdf`, {
    responseType: 'blob',
  });
  const blob = new Blob([response.data], { type: 'application/pdf' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${reportNumber}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/**
 * Send Z-Report via email
 */
export function useSendZReportEmail() {
  return useMutation({
    mutationFn: async ({
      id,
      emails,
    }: {
      id: string;
      emails?: string[];
    }): Promise<{ success: boolean; message: string }> => {
      const response = await api.post(`/z-reports/${id}/send-email`, { emails });
      return response.data;
    },
  });
}
