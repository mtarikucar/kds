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

// ── Period-over-period comparison (trends) ──────────────────────────────────
export interface SalesComparisonMetric {
  metric: string;
  current: number;
  previous: number;
  change: number;
  /** Rounded to 1 decimal by the backend; null when the previous window is 0. */
  changePct: number | null;
}

export interface SalesComparison {
  current: { startDate: string; endDate: string };
  previous: { startDate: string; endDate: string };
  metrics: SalesComparisonMetric[];
  foodCostPct: { current: number | null; previous: number | null };
}

export const useSalesComparison = (params: SalesReportDto) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['reports', 'sales-comparison', params, branchId],
    queryFn: async (): Promise<SalesComparison> => {
      const response = await api.get('/reports/sales-comparison', { params });
      return response.data;
    },
    enabled: !!params.startDate && !!params.endDate,
  });
};

/**
 * Pure helper: pull one metric's period-over-period trend out of the
 * comparison payload in the shape StatCard-style trend badges expect.
 * Returns undefined when the metric is absent or the previous window had no
 * data (changePct null) — a "±∞%" badge would be noise, not signal.
 */
export function metricTrend(
  comparison: SalesComparison | undefined,
  metric: string,
): { value: number; isPositive: boolean } | undefined {
  const m = comparison?.metrics?.find((x) => x.metric === metric);
  if (!m || m.changePct == null) return undefined;
  return { value: Math.abs(m.changePct), isPositive: m.changePct >= 0 };
}

// ── CSV export ───────────────────────────────────────────────────────────────
/**
 * Download the daily sales breakdown as a CSV file (accountant export).
 * Same blob-anchor pattern as downloadZReportPdf (api/zReportsApi.ts).
 */
export async function downloadSalesCsv(params: SalesReportDto) {
  const response = await api.get('/reports/sales.csv', {
    params,
    responseType: 'blob',
  });
  const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sales_${params.startDate}_${params.endDate}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

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

/**
 * COGS report — also carries wasteCost / wasteCostPct (shrinkage is surfaced
 * separately from COGS by the backend), which FinanceTab renders as its own
 * card.
 */
export const useCogsReport = (params: RangeParams) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['reports', 'cogs', params, branchId],
    queryFn: async () => {
      const response = await api.get('/reports/cogs', { params });
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
