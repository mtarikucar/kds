import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { getApiErrorMessage } from '../../lib/api-error';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import i18n from '../../i18n/config';
import { toast } from 'sonner';
import type { PaginatedResponse } from '../../types';
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
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<Attendance | { status: string; date: string }>({
    queryKey: ['personnel', 'attendance', 'my-status', branchId],
    queryFn: async () => {
      const response = await api.get('/personnel/attendance/my-status');
      return response.data;
    },
    refetchInterval: 30000,
  });
};

export const useAttendanceToday = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<Attendance[]>({
    queryKey: ['personnel', 'attendance', 'today', branchId],
    queryFn: async () => {
      const response = await api.get('/personnel/attendance/today');
      return response.data;
    },
    refetchInterval: 30000,
  });
};

export const useAttendanceList = (
  params?: { startDate?: string; endDate?: string; userId?: string; status?: string; page?: number; limit?: number },
  options?: { enabled?: boolean },
) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<PaginatedResponse<Attendance>>({
    queryKey: ['personnel', 'attendance', 'history', params, branchId],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Attendance>>('/personnel/attendance', { params });
      return response.data;
    },
    enabled: options?.enabled,
  });
};

export const useAttendanceSummary = (params?: { startDate?: string; endDate?: string; period?: string }) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<AttendanceSummary[]>({
    queryKey: ['personnel', 'attendance', 'summary', params, branchId],
    queryFn: async () => {
      const response = await api.get('/personnel/attendance/summary', { params });
      return response.data;
    },
  });
};

/**
 * Download the attendance summary as a CSV (worked/overtime/late minutes per
 * staff member). This is an attendance/hours export — NOT payroll: the system
 * stores no wage rate and the CSV carries no monetary columns. Fetches through
 * the api client so the auth header + branch scope are applied, then triggers
 * a browser download from the blob.
 */
export const downloadAttendanceSummaryCsv = async (params?: {
  startDate?: string;
  endDate?: string;
  period?: string;
}): Promise<void> => {
  const response = await api.get('/personnel/attendance/summary/export', {
    params,
    responseType: 'blob',
  });
  const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'attendance-summary.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};

// ========================================
// SHIFT TEMPLATES
// ========================================

export const useShiftTemplates = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<ShiftTemplate[]>({
    queryKey: ['personnel', 'shift-templates', branchId],
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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<WeeklyScheduleResponse>({
    queryKey: ['personnel', 'schedule', weekStart, branchId],
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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};

// ========================================
// SHIFT SWAP
// ========================================

export const useSwapRequests = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<ShiftSwapRequest[]>({
    queryKey: ['personnel', 'swap-requests', branchId],
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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};

// ========================================
// PERFORMANCE
// ========================================

export const usePerformanceMetrics = (
  params?: { startDate?: string; endDate?: string; userId?: string },
  enabled = true,
) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<PerformanceMetrics[]>({
    queryKey: ['personnel', 'performance', 'metrics', params, branchId],
    queryFn: async () => {
      const response = await api.get('/personnel/performance/metrics', { params });
      return response.data;
    },
    enabled,
  });
};

export const usePerformanceTrends = (params?: { userId?: string }) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<PerformanceTrend[]>({
    queryKey: ['personnel', 'performance', 'trends', params, branchId],
    queryFn: async () => {
      const response = await api.get('/personnel/performance/trends', { params });
      return response.data;
    },
  });
};
