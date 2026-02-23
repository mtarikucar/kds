import { useQuery, useMutation } from '@tanstack/react-query';
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

export const useAvailableSlots = (tenantId: string, date: string, guestCount?: number) => {
  return useQuery<AvailableSlot[]>({
    queryKey: ['availableSlots', tenantId, date, guestCount],
    queryFn: async () => {
      const response = await publicApi.get(`/public/reservations/${tenantId}/available-slots`, {
        params: { date, guestCount },
      });
      return response.data;
    },
    enabled: !!tenantId && !!date,
  });
};

export const useAvailableTables = (tenantId: string, date: string, startTime: string, endTime: string, guestCount?: number) => {
  return useQuery<AvailableTable[]>({
    queryKey: ['availableTables', tenantId, date, startTime, endTime, guestCount],
    queryFn: async () => {
      const response = await publicApi.get(`/public/reservations/${tenantId}/tables`, {
        params: { date, startTime, endTime, guestCount },
      });
      return response.data;
    },
    enabled: !!tenantId && !!date && !!startTime && !!endTime,
  });
};

export const useCreatePublicReservation = () => {
  return useMutation({
    mutationFn: async ({ tenantId, data }: { tenantId: string; data: CreateReservationDto }) => {
      const response = await publicApi.post(`/public/reservations/${tenantId}`, data);
      return response.data as Reservation;
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
    mutationFn: async ({ tenantId, id }: { tenantId: string; id: string }) => {
      const response = await publicApi.patch(`/public/reservations/${tenantId}/${id}/cancel`);
      return response.data as Reservation;
    },
  });
};
