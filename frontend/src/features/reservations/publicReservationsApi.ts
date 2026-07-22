import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import axios from 'axios';
import type {
  Reservation,
  ReservationSettings,
  AvailableSlot,
  AvailableTable,
  CreateReservationDto,
} from '../../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const publicApi = axios.create({
  baseURL: API_URL,
});

// ----------------------------------------------------------------------
// Error classification — turn opaque axios rejections into stable codes
// the public flow can map to translated, actionable copy. The backend
// speaks English exception messages (NestJS BadRequest/Conflict); we
// match on stable substrings + HTTP status so a guest never sees a raw
// server string or (the audit's top finding) a silent no-op.
// ----------------------------------------------------------------------

function extractError(error: unknown): { status?: number; message: string } {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const raw = (error.response?.data as { message?: string | string[] } | undefined)?.message;
    const message = Array.isArray(raw)
      ? raw.join(' ')
      : typeof raw === 'string'
        ? raw
        : '';
    return { status, message };
  }
  return { message: error instanceof Error ? error.message : '' };
}

export type CreateReservationErrorCode =
  | 'tableTaken'
  | 'slotFull'
  | 'duplicate'
  | 'rateLimited'
  | 'generic';

/**
 * Classify a failed public-create. `isConflict` marks the codes a guest
 * can recover from by re-picking a time (the table/slot filled while they
 * were booking) — those get the "refresh times" affordance.
 */
export function classifyCreateReservationError(error: unknown): {
  code: CreateReservationErrorCode;
  isConflict: boolean;
} {
  const { status, message } = extractError(error);
  if (status === 429) return { code: 'rateLimited', isConflict: false };
  const m = message.toLowerCase();
  if (m.includes('already reserved')) return { code: 'tableTaken', isConflict: true };
  if (m.includes('fully booked')) return { code: 'slotFull', isConflict: true };
  if (m.includes('already have a reservation'))
    return { code: 'duplicate', isConflict: false };
  return { code: 'generic', isConflict: false };
}

const CREATE_ERROR_KEYS: Record<CreateReservationErrorCode, string> = {
  tableTaken: 'public.errorTableTaken',
  slotFull: 'public.errorSlotFull',
  duplicate: 'public.errorDuplicate',
  rateLimited: 'public.errorRateLimited',
  generic: 'public.errorGeneric',
};

export function createReservationErrorKey(code: CreateReservationErrorCode): string {
  return CREATE_ERROR_KEYS[code];
}

export type CancelReservationErrorCode =
  | 'deadline'
  | 'disabled'
  | 'cannotCancel'
  | 'rateLimited'
  | 'generic';

/** Classify a failed cancel so the lookup modal can explain WHY inline. */
export function classifyCancelError(error: unknown): CancelReservationErrorCode {
  const { status, message } = extractError(error);
  if (status === 429) return 'rateLimited';
  const m = message.toLowerCase();
  if (m.includes('deadline')) return 'deadline';
  if (m.includes('not allowed')) return 'disabled';
  if (m.includes('cannot be cancelled')) return 'cannotCancel';
  return 'generic';
}

const CANCEL_ERROR_KEYS: Record<CancelReservationErrorCode, string> = {
  deadline: 'lookup.deadlinePassed',
  disabled: 'lookup.cancelDisabled',
  cannotCancel: 'lookup.cannotCancel',
  rateLimited: 'lookup.tempError',
  generic: 'lookup.cancelError',
};

export function cancelReservationErrorKey(code: CancelReservationErrorCode): string {
  return CANCEL_ERROR_KEYS[code];
}

/**
 * A lookup failing 429/5xx (or a transport error the throttle/server threw)
 * is TEMPORARY — the reservation may well exist. Only a definitive 4xx
 * (404 not-found, 400 bad verification) means "no such reservation". This
 * keeps a rate-limited guest from being falsely told their booking is gone.
 */
export function classifyLookupError(error: unknown): 'notFound' | 'temporary' {
  const { status } = extractError(error);
  if (status === 429 || (status !== undefined && status >= 500)) return 'temporary';
  return 'notFound';
}

export const usePublicReservationSettings = (tenantId: string) => {
  return useQuery<Partial<ReservationSettings>>({
    queryKey: ['publicReservationSettings', tenantId],
    queryFn: async () => {
      const response = await publicApi.get(`/public/reservations/${tenantId}/settings`);
      return response.data;
    },
    enabled: !!tenantId,
  });
};

export interface PublicBranch {
  id: string;
  name: string;
}

/** Bookable (active) branches for the public branch picker. */
export const usePublicBranches = (tenantId: string) => {
  return useQuery<PublicBranch[]>({
    queryKey: ['publicBranches', tenantId],
    queryFn: async () => {
      const response = await publicApi.get(`/public/reservations/${tenantId}/branches`);
      return response.data;
    },
    enabled: !!tenantId,
  });
};

export const useAvailableSlots = (
  tenantId: string,
  date: string,
  guestCount?: number,
  branchId?: string,
) => {
  return useQuery<AvailableSlot[]>({
    queryKey: ['availableSlots', tenantId, date, guestCount, branchId],
    queryFn: async () => {
      const response = await publicApi.get(`/public/reservations/${tenantId}/available-slots`, {
        params: { date, guestCount, branchId },
      });
      return response.data;
    },
    enabled: !!tenantId && !!date,
  });
};

export const useAvailableTables = (
  tenantId: string,
  date: string,
  startTime: string,
  endTime: string,
  guestCount?: number,
  branchId?: string,
) => {
  return useQuery<AvailableTable[]>({
    queryKey: ['availableTables', tenantId, date, startTime, endTime, guestCount, branchId],
    queryFn: async () => {
      const response = await publicApi.get(`/public/reservations/${tenantId}/tables`, {
        params: { date, startTime, endTime, guestCount, branchId },
      });
      return response.data;
    },
    enabled: !!tenantId && !!date && !!startTime && !!endTime,
  });
};

export const useCreatePublicReservation = () => {
  const { t } = useTranslation('reservations');
  return useMutation({
    mutationFn: async ({ tenantId, data }: { tenantId: string; data: CreateReservationDto }) => {
      const response = await publicApi.post(`/public/reservations/${tenantId}`, data);
      return response.data as Reservation;
    },
    // Surface every failure — the audit found this path was 100% silent.
    // The transient toast fires here; the container additionally renders a
    // persistent inline alert (with a "refresh times" action on conflicts)
    // off the same mutation error state.
    onError: (error: unknown) => {
      const { code } = classifyCreateReservationError(error);
      toast.error(t(createReservationErrorKey(code)));
    },
  });
};

export const useLookupReservation = () => {
  return useMutation({
    mutationFn: async ({ tenantId, phone, reservationNumber }: { tenantId: string; phone: string; reservationNumber: string }) => {
      const response = await publicApi.get(`/public/reservations/${tenantId}/lookup`, {
        params: { phone, reservationNumber },
      });
      return response.data as Reservation;
    },
  });
};

export const useCancelPublicReservation = () => {
  return useMutation({
    mutationFn: async ({
      tenantId,
      id,
      customerPhone,
      reservationNumber,
    }: {
      tenantId: string;
      id: string;
      customerPhone: string;
      reservationNumber: string;
    }) => {
      const response = await publicApi.patch(
        `/public/reservations/${tenantId}/${id}/cancel`,
        { customerPhone, reservationNumber },
      );
      return response.data as Reservation;
    },
  });
};
