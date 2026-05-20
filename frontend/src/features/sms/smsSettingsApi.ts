import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';

export interface SmsSettings {
  id: string;
  tenantId: string;
  isEnabled: boolean;
  smsOnReservationCreated: boolean;
  smsOnReservationConfirmed: boolean;
  smsOnReservationRejected: boolean;
  smsOnReservationCancelled: boolean;
  // Per-event email channel toggles. The channel-aware reservation
  // notification service prefers email when the customer left one
  // AND the matching emailOn* toggle is on; falls back to SMS
  // otherwise. Lives on SmsSettings (rather than a new table)
  // because the surface is small and admin sees both channels
  // in one place.
  emailOnReservationCreated: boolean;
  emailOnReservationConfirmed: boolean;
  emailOnReservationRejected: boolean;
  emailOnReservationCancelled: boolean;
  smsOnOrderCreated: boolean;
  smsOnOrderApproved: boolean;
  smsOnOrderPreparing: boolean;
  smsOnOrderReady: boolean;
  smsOnOrderCancelled: boolean;
}

export interface UpdateSmsSettingsDto {
  isEnabled?: boolean;
  smsOnReservationCreated?: boolean;
  smsOnReservationConfirmed?: boolean;
  smsOnReservationRejected?: boolean;
  smsOnReservationCancelled?: boolean;
  emailOnReservationCreated?: boolean;
  emailOnReservationConfirmed?: boolean;
  emailOnReservationRejected?: boolean;
  emailOnReservationCancelled?: boolean;
  smsOnOrderCreated?: boolean;
  smsOnOrderApproved?: boolean;
  smsOnOrderPreparing?: boolean;
  smsOnOrderReady?: boolean;
  smsOnOrderCancelled?: boolean;
}

export const useGetSmsSettings = () => {
  return useQuery<SmsSettings>({
    queryKey: ['smsSettings'],
    queryFn: async () => {
      const response = await api.get('/sms-settings');
      return response.data;
    },
  });
};

export const useUpdateSmsSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateSmsSettingsDto) => {
      const response = await api.patch('/sms-settings', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smsSettings'] });
    },
  });
};
