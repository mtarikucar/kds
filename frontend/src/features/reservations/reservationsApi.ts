import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { getApiErrorMessage } from '../../lib/api-error';
import { useBranchScopeStore } from '../../store/branchScopeStore';
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

export interface ReservationListParams {
  date?: string;
  /** Inclusive range start (YYYY-MM-DD). When `date` is also given the
   *  server prefers `date` — send one OR the other, not both. */
  dateFrom?: string;
  /** Inclusive range end (YYYY-MM-DD). */
  dateTo?: string;
  status?: string;
  tableId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/** Staff-side create payload (POST /reservations). Distinct from the
 *  public CreateReservationDto: staff pick a `source` and can auto-seat a
 *  walk-in. `endTime` is optional — the server defaults it to
 *  `startTime + settings.defaultDuration`. */
export interface CreateStaffReservationDto {
  date: string;
  startTime: string;
  endTime?: string;
  guestCount: number;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
  adminNotes?: string;
  tableId?: string;
  branchId?: string;
  source: 'PHONE' | 'WALKIN';
  autoSeat?: boolean;
}

// Reservation queries
export const useReservations = (params?: ReservationListParams, options?: { enabled?: boolean }) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<PaginatedResponse<Reservation>>({
    queryKey: ['reservations', params, branchId],
    queryFn: async () => {
      const response = await api.get('/reservations', { params });
      return response.data;
    },
    enabled: options?.enabled ?? true,
  });
};

/**
 * Badge count for the sidebar + Bekleyenler tab: PENDING rows dated today
 * or later (server UTC-anchors the day). Nested under the ['reservations']
 * key prefix so any list/stat invalidation (local mutations OR the
 * reservation socket) refreshes it for free; the 60s poll is a fallback for
 * a dropped socket. */
export const usePendingReservationCount = (options?: { enabled?: boolean }) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<{ count: number }>({
    queryKey: ['reservations', 'pending-count', branchId],
    queryFn: async () => {
      const response = await api.get('/reservations/pending-count');
      return response.data;
    },
    enabled: options?.enabled ?? true,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
};

export const useReservation = (id: string) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<Reservation>({
    queryKey: ['reservations', id, branchId],
    queryFn: async () => {
      const response = await api.get(`/reservations/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

export const useReservationStats = (date?: string) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<ReservationStats>({
    queryKey: ['reservationStats', date, branchId],
    queryFn: async () => {
      const response = await api.get('/reservations/stats', { params: { date } });
      return response.data;
    },
  });
};

// Reservation mutations
export const useCreateReservation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateStaffReservationDto) => {
      const response = await api.post('/reservations', data);
      return response.data as Reservation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['reservationStats'] });
      // A WALKIN with autoSeat immediately flips its table → OCCUPIED, so
      // the floor plan / POS need the fresh table state; harmless for a
      // plain PHONE create.
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('reservations:notifications.created'));
    },
    onError: (error: any) => {
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};

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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      // confirm flips the reservation to CONFIRMED — table status
      // doesn't move yet, but GET /tables annotates each row with
      // `upcomingReservation` based on the reservation list, so the
      // floor plan badge needs a fresh read.
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('reservations:notifications.confirmed'));
    },
    onError: (error: any) => {
      // 4xx on a lifecycle transition usually means the row already
      // moved (another terminal confirmed/cancelled it) — refetch so
      // the floor plan and reservation list reflect reality.
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      // reject releases any auto-hold on the table (lifecycle hook in
      // ReservationsService.reject), so the floor plan / POS need
      // fresh table state.
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('reservations:notifications.rejected'));
    },
    onError: (error: any) => {
      // Same conflict-class refetch as confirm; covers "already
      // rejected by another terminal" 409s.
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      // seat flips the table → OCCUPIED in lock step with the
      // reservation row; the POS reservation modal expects this
      // invalidation so the just-seated table appears OCCUPIED on the
      // next render (otherwise the stale cache still shows RESERVED
      // and the modal would re-open on a re-click).
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('reservations:notifications.seated'));
    },
    onError: (error: any) => {
      // 404 (reservation gone) and 409 (already SEATED/COMPLETED, or
      // table state mismatch) almost always mean our local cache is
      // stale — refetch so the caller sees the real state instead of
      // looping on the same error. Cheap: ['tables'] is a single
      // tenant-scoped list.
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      // complete frees the table → AVAILABLE.
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('reservations:notifications.completed'));
    },
    onError: (error: any) => {
      // 409 if the reservation moved off SEATED before complete
      // landed — refetch so the user sees current state.
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      // no-show releases the auto-hold and clears the upcoming-reservation
      // annotation — tables list needs the fresh state.
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('reservations:notifications.noShow'));
    },
    onError: (error: any) => {
      // Same conflict-class refetch; another terminal may have
      // already marked the row or the guest may have arrived.
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      // cancel releases the auto-hold (lifecycle hook in
      // ReservationsService.cancel) — refresh tables so the formerly
      // RESERVED row drops back to AVAILABLE on the floor plan.
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('reservations:notifications.cancelled'));
    },
    onError: (error: any) => {
      // 409 if the reservation can no longer be cancelled (already
      // SEATED/COMPLETED). Refetch so the user sees the final state.
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
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
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};

// Settings
export const useReservationSettings = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery<ReservationSettings>({
    queryKey: ['reservationSettings', branchId],
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
