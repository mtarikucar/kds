import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import {
  DateRangeParams,
  HeatmapQueryParams,
  HeatmapResponse,
  HeatmapGranularity,
  TrafficFlowResponse,
  CongestionResponse,
  TableAnalyticsResponse,
  TableTrendResponse,
  CustomerBehavior,
  TableUtilization,
  InsightListResponse,
  InsightSummary,
  Insight,
  InsightStatus,
  Camera,
  CameraHealthSummary,
  MockDataGenerationResult,
} from './types';

// Keys for React Query
export const analyticsKeys = {
  all: ['analytics'] as const,
  heatmaps: () => [...analyticsKeys.all, 'heatmaps'] as const,
  heatmap: (type: string, params: HeatmapQueryParams) => [...analyticsKeys.heatmaps(), type, params] as const,
  traffic: () => [...analyticsKeys.all, 'traffic'] as const,
  trafficFlow: (params: DateRangeParams) => [...analyticsKeys.traffic(), 'flow', params] as const,
  congestion: (params: DateRangeParams) => [...analyticsKeys.traffic(), 'congestion', params] as const,
  tables: () => [...analyticsKeys.all, 'tables'] as const,
  tableUtilization: (params: DateRangeParams) => [...analyticsKeys.tables(), 'utilization', params] as const,
  tableTrends: (params: DateRangeParams) => [...analyticsKeys.tables(), 'trends', params] as const,
  underutilizedTables: (threshold?: number) => [...analyticsKeys.tables(), 'underutilized', threshold] as const,
  customerBehavior: (params: DateRangeParams) => [...analyticsKeys.all, 'customer-behavior', params] as const,
  insights: () => [...analyticsKeys.all, 'insights'] as const,
  insightList: (filters?: Record<string, unknown>) => [...analyticsKeys.insights(), 'list', filters] as const,
  insightSummary: () => [...analyticsKeys.insights(), 'summary'] as const,
  actionableInsights: () => [...analyticsKeys.insights(), 'actionable'] as const,
  insight: (id: string) => [...analyticsKeys.insights(), id] as const,
  cameras: () => [...analyticsKeys.all, 'cameras'] as const,
  cameraHealth: () => [...analyticsKeys.cameras(), 'health'] as const,
  camera: (id: string) => [...analyticsKeys.cameras(), id] as const,
};

// ==================== HEATMAP HOOKS ====================

export const useOccupancyHeatmap = (params: HeatmapQueryParams) => {
  return useQuery({
    queryKey: analyticsKeys.heatmap('occupancy', params),
    queryFn: async (): Promise<HeatmapResponse> => {
      const response = await api.get('/analytics/heatmap/occupancy', { params });
      return response.data;
    },
    enabled: true,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useTrafficHeatmap = (params: HeatmapQueryParams) => {
  return useQuery({
    queryKey: analyticsKeys.heatmap('traffic', params),
    queryFn: async (): Promise<HeatmapResponse> => {
      const response = await api.get('/analytics/heatmap/traffic', { params });
      return response.data;
    },
    enabled: true,
    staleTime: 5 * 60 * 1000,
  });
};

export const useDwellTimeHeatmap = (params: HeatmapQueryParams) => {
  return useQuery({
    queryKey: analyticsKeys.heatmap('dwell-time', params),
    queryFn: async (): Promise<HeatmapResponse> => {
      const response = await api.get('/analytics/heatmap/dwell-time', { params });
      return response.data;
    },
    enabled: true,
    staleTime: 5 * 60 * 1000,
  });
};

// ==================== TRAFFIC FLOW HOOKS ====================

export const useTrafficFlow = (params: DateRangeParams & { limit?: number }) => {
  return useQuery({
    queryKey: analyticsKeys.trafficFlow(params),
    queryFn: async (): Promise<TrafficFlowResponse> => {
      const response = await api.get('/analytics/traffic/flow', { params });
      return response.data;
    },
    enabled: true,
    staleTime: 5 * 60 * 1000,
  });
};

export const useCongestionAnalysis = (params: DateRangeParams) => {
  return useQuery({
    queryKey: analyticsKeys.congestion(params),
    queryFn: async (): Promise<CongestionResponse> => {
      const response = await api.get('/analytics/traffic/congestion', { params });
      return response.data;
    },
    enabled: true,
    staleTime: 10 * 60 * 1000,
  });
};

// ==================== TABLE ANALYTICS HOOKS ====================

export const useTableUtilization = (params: DateRangeParams) => {
  return useQuery({
    queryKey: analyticsKeys.tableUtilization(params),
    queryFn: async (): Promise<TableAnalyticsResponse> => {
      const response = await api.get('/analytics/tables/utilization', { params });
      return response.data;
    },
    enabled: true,
    staleTime: 5 * 60 * 1000,
  });
};

export const useTableTrends = (params: DateRangeParams) => {
  return useQuery({
    queryKey: analyticsKeys.tableTrends(params),
    queryFn: async (): Promise<TableTrendResponse> => {
      const response = await api.get('/analytics/tables/trends', { params });
      return response.data;
    },
    enabled: true,
    staleTime: 10 * 60 * 1000,
  });
};

export const useUnderutilizedTables = (threshold?: number) => {
  return useQuery({
    queryKey: analyticsKeys.underutilizedTables(threshold),
    queryFn: async (): Promise<TableUtilization[]> => {
      const response = await api.get('/analytics/tables/underutilized', {
        params: threshold ? { threshold } : undefined,
      });
      return response.data;
    },
    enabled: true,
    staleTime: 10 * 60 * 1000,
  });
};

export const useCustomerBehavior = (params: DateRangeParams) => {
  return useQuery({
    queryKey: analyticsKeys.customerBehavior(params),
    queryFn: async (): Promise<CustomerBehavior> => {
      const response = await api.get('/analytics/customer-behavior', { params });
      return response.data;
    },
    enabled: true,
    staleTime: 10 * 60 * 1000,
  });
};

// ==================== INSIGHTS HOOKS ====================

export interface InsightFilters {
  type?: string;
  category?: string;
  severity?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export const useInsights = (filters?: InsightFilters) => {
  return useQuery({
    queryKey: analyticsKeys.insightList(filters),
    queryFn: async (): Promise<InsightListResponse> => {
      const response = await api.get('/analytics/insights', { params: filters });
      return response.data;
    },
    enabled: true,
    staleTime: 2 * 60 * 1000,
  });
};

export const useInsightSummary = () => {
  return useQuery({
    queryKey: analyticsKeys.insightSummary(),
    queryFn: async (): Promise<InsightSummary> => {
      const response = await api.get('/analytics/insights/summary');
      return response.data;
    },
    enabled: true,
    staleTime: 2 * 60 * 1000,
  });
};

export const useActionableInsights = () => {
  return useQuery({
    queryKey: analyticsKeys.actionableInsights(),
    queryFn: async (): Promise<Insight[]> => {
      const response = await api.get('/analytics/insights/actionable');
      return response.data;
    },
    enabled: true,
    staleTime: 2 * 60 * 1000,
  });
};

export const useInsight = (id: string) => {
  return useQuery({
    queryKey: analyticsKeys.insight(id),
    queryFn: async (): Promise<Insight> => {
      const response = await api.get(`/analytics/insights/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

export const useUpdateInsightStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      dismissedReason,
    }: {
      id: string;
      status: InsightStatus;
      dismissedReason?: string;
    }): Promise<Insight> => {
      const response = await api.put(`/analytics/insights/${id}/status`, {
        status,
        dismissedReason,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analyticsKeys.insights() });
    },
  });
};

export const useGenerateInsights = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<{ generated: number }> => {
      const response = await api.post('/analytics/insights/generate');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analyticsKeys.insights() });
    },
  });
};

// ==================== CAMERA HOOKS ====================

export const useCameras = () => {
  return useQuery({
    queryKey: analyticsKeys.cameras(),
    queryFn: async (): Promise<Camera[]> => {
      const response = await api.get('/analytics/cameras');
      return response.data;
    },
    enabled: true,
    staleTime: 60 * 1000,
  });
};

export const useCameraHealth = () => {
  return useQuery({
    queryKey: analyticsKeys.cameraHealth(),
    queryFn: async (): Promise<CameraHealthSummary> => {
      const response = await api.get('/analytics/cameras/health');
      return response.data;
    },
    enabled: true,
    staleTime: 30 * 1000,
  });
};

export const useCamera = (id: string) => {
  return useQuery({
    queryKey: analyticsKeys.camera(id),
    queryFn: async (): Promise<Camera> => {
      const response = await api.get(`/analytics/cameras/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

export const useCreateCamera = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: Partial<Camera>): Promise<Camera> => {
      const response = await api.post('/analytics/cameras', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analyticsKeys.cameras() });
    },
  });
};

export const useUpdateCamera = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Camera>;
    }): Promise<Camera> => {
      const response = await api.put(`/analytics/cameras/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analyticsKeys.cameras() });
    },
  });
};

export const useDeleteCamera = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/analytics/cameras/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analyticsKeys.cameras() });
    },
  });
};

// ==================== MOCK DATA HOOKS (DEV ONLY) ====================

export const useGenerateMockData = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (days?: number): Promise<MockDataGenerationResult> => {
      const response = await api.post('/analytics/mock-data/generate', {}, {
        params: days ? { days } : undefined,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
    },
  });
};

export const useClearMockData = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      await api.delete('/analytics/mock-data');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analyticsKeys.all });
    },
  });
};
