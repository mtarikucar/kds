import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import i18n from '../../i18n/config';
import { toast } from 'sonner';
import type {
  Attendance,
  AttendanceSummary,
  ShiftTemplate,
  ShiftAssignment,
  ShiftSwapRequest,
  PerformanceMetrics,
  PerformanceTrend,
  CreateShiftTemplateDto,
  UpdateShiftTemplateDto,
  AssignShiftDto,
  CreateSwapRequestDto,
} from '../../types';

// ========================================
// ATTENDANCE
// ========================================

export const useMyAttendanceStatus = () => {
  return useQuery<Attendance | { status: string; date: string }>({
    queryKey: ['personnel', 'attendance', 'my-status'],
    queryFn: async () => {
      const response = await api.get('/personnel/attendance/my-status');
      return response.data;
    },
    refetchInterval: 30000,
  });
};

export const useAttendanceToday = () => {
  return useQuery<Attendance[]>({
    queryKey: ['personnel', 'attendance', 'today'],
    queryFn: async () => {
      const response = await api.get('/personnel/attendance/today');
      return response.data;
    },
    refetchInterval: 30000,
  });
};

interface PaginatedAttendance {
  data: Attendance[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const useAttendanceList = (
  params?: { startDate?: string; endDate?: string; userId?: string; status?: string; page?: number; limit?: number },
  options?: { enabled?: boolean },
) => {
  return useQuery<PaginatedAttendance>({
    queryKey: ['personnel', 'attendance', 'history', params],
    queryFn: async () => {
      const response = await api.get('/personnel/attendance', { params });
      return response.data;
    },
    enabled: options?.enabled,
  });
};

export const useAttendanceSummary = (params?: { startDate?: string; endDate?: string; period?: string }) => {
  return useQuery<AttendanceSummary[]>({
    queryKey: ['personnel', 'attendance', 'summary', params],
    queryFn: async () => {
      const response = await api.get('/personnel/attendance/summary', { params });
      return response.data;
    },
  });
};

export const useClockIn = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (notes?: string) => {
      const response = await api.post('/personnel/attendance/clock-in', { notes });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'attendance'] });
      toast.success(i18n.t('personnel:attendance.clockedIn'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useClockOut = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await api.post('/personnel/attendance/clock-out');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'attendance'] });
      toast.success(i18n.t('personnel:attendance.clockedOut'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useStartBreak = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await api.post('/personnel/attendance/break-start');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'attendance'] });
      toast.success(i18n.t('personnel:attendance.breakStarted'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useEndBreak = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await api.post('/personnel/attendance/break-end');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'attendance'] });
      toast.success(i18n.t('personnel:attendance.breakEnded'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

// ========================================
// SHIFT TEMPLATES
// ========================================

export const useShiftTemplates = () => {
  return useQuery<ShiftTemplate[]>({
    queryKey: ['personnel', 'shift-templates'],
    queryFn: async () => {
      const response = await api.get('/personnel/shift-templates');
      return response.data;
    },
  });
};

export const useCreateShiftTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateShiftTemplateDto) => {
      const response = await api.post('/personnel/shift-templates', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'shift-templates'] });
      toast.success(i18n.t('personnel:shifts.created'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useUpdateShiftTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateShiftTemplateDto }) => {
      const response = await api.patch(`/personnel/shift-templates/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'shift-templates'] });
      toast.success(i18n.t('personnel:shifts.updated'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useDeleteShiftTemplate = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.delete(`/personnel/shift-templates/${id}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'shift-templates'] });
      toast.success(i18n.t('personnel:shifts.deleted'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

// ========================================
// SCHEDULE
// ========================================

interface WeeklyScheduleResponse {
  weekStart: string;
  weekEnd: string;
  assignments: ShiftAssignment[];
  staff: { id: string; firstName: string; lastName: string; role: string }[];
}

export const useWeeklySchedule = (weekStart?: string) => {
  return useQuery<WeeklyScheduleResponse>({
    queryKey: ['personnel', 'schedule', weekStart],
    queryFn: async () => {
      const response = await api.get('/personnel/schedule', { params: { weekStart } });
      return response.data;
    },
  });
};

export const useAssignShift = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: AssignShiftDto) => {
      const response = await api.post('/personnel/schedule/assign', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'schedule'] });
      toast.success(i18n.t('personnel:schedule.assigned'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useRemoveAssignment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.delete(`/personnel/schedule/${id}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'schedule'] });
      toast.success(i18n.t('personnel:schedule.removed'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

// ========================================
// SHIFT SWAP
// ========================================

export const useSwapRequests = () => {
  return useQuery<ShiftSwapRequest[]>({
    queryKey: ['personnel', 'swap-requests'],
    queryFn: async () => {
      const response = await api.get('/personnel/shift-swap');
      return response.data;
    },
  });
};

export const useCreateSwapRequest = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateSwapRequestDto) => {
      const response = await api.post('/personnel/shift-swap/request', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'swap-requests'] });
      toast.success(i18n.t('personnel:swap.requested'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useApproveSwap = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.patch(`/personnel/shift-swap/${id}/approve`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'swap-requests'] });
      queryClient.invalidateQueries({ queryKey: ['personnel', 'schedule'] });
      toast.success(i18n.t('personnel:swap.approved'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useRejectSwap = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.patch(`/personnel/shift-swap/${id}/reject`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'swap-requests'] });
      toast.success(i18n.t('personnel:swap.rejected'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

// ========================================
// PERFORMANCE
// ========================================

export const usePerformanceMetrics = (params?: { startDate?: string; endDate?: string; userId?: string }) => {
  return useQuery<PerformanceMetrics[]>({
    queryKey: ['personnel', 'performance', 'metrics', params],
    queryFn: async () => {
      const response = await api.get('/personnel/performance/metrics', { params });
      return response.data;
    },
  });
};

export const usePerformanceTrends = (params?: { userId?: string }) => {
  return useQuery<PerformanceTrend[]>({
    queryKey: ['personnel', 'performance', 'trends', params],
    queryFn: async () => {
      const response = await api.get('/personnel/performance/trends', { params });
      return response.data;
    },
  });
};
