import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import i18n from '../../i18n/config';
import { toast } from 'sonner';
import type {
  Reservation,
  ReservationSettings,
  ReservationStats,
  UpdateReservationDto,
  UpdateReservationSettingsDto,
} from '../../types';

interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Reservation queries
export const useReservations = (params?: { date?: string; status?: string; tableId?: string; search?: string; page?: number; limit?: number }) => {
  return useQuery<PaginatedResponse<Reservation>>({
    queryKey: ['reservations', params],
    queryFn: async () => {
      const response = await api.get('/reservations', { params });
      return response.data;
    },
  });
};

export const useReservation = (id: string) => {
  return useQuery<Reservation>({
    queryKey: ['reservations', id],
    queryFn: async () => {
      const response = await api.get(`/reservations/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

export const useReservationStats = (date?: string) => {
  return useQuery<ReservationStats>({
    queryKey: ['reservationStats', date],
    queryFn: async () => {
      const response = await api.get('/reservations/stats', { params: { date } });
      return response.data;
    },
  });
};

// Reservation mutations
export const useUpdateReservation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateReservationDto }) => {
      const response = await api.patch(`/reservations/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['reservationStats'] });
      toast.success(i18n.t('reservations:notifications.updated'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useConfirmReservation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.patch(`/reservations/${id}/confirm`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['reservationStats'] });
      toast.success(i18n.t('reservations:notifications.confirmed'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useRejectReservation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, rejectionReason }: { id: string; rejectionReason?: string }) => {
      const response = await api.patch(`/reservations/${id}/reject`, { rejectionReason });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['reservationStats'] });
      toast.success(i18n.t('reservations:notifications.rejected'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useSeatReservation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.patch(`/reservations/${id}/seat`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['reservationStats'] });
      toast.success(i18n.t('reservations:notifications.seated'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useCompleteReservation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.patch(`/reservations/${id}/complete`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['reservationStats'] });
      toast.success(i18n.t('reservations:notifications.completed'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useNoShowReservation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.patch(`/reservations/${id}/no-show`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['reservationStats'] });
      toast.success(i18n.t('reservations:notifications.noShow'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useCancelReservation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.patch(`/reservations/${id}/cancel`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['reservationStats'] });
      toast.success(i18n.t('reservations:notifications.cancelled'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useDeleteReservation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.delete(`/reservations/${id}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['reservationStats'] });
      toast.success(i18n.t('reservations:notifications.deleted'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

// Settings
export const useReservationSettings = () => {
  return useQuery<ReservationSettings>({
    queryKey: ['reservationSettings'],
    queryFn: async () => {
      const response = await api.get('/reservations/settings/current');
      return response.data;
    },
  });
};

export const useUpdateReservationSettings = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: UpdateReservationSettingsDto) => {
      const response = await api.patch('/reservations/settings/current', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservationSettings'] });
    },
  });
};
