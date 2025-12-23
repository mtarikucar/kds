import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import {
  QrMenuSettings,
  CreateQrSettingsDto,
  UpdateQrSettingsDto,
  QrCodeData,
} from '../../types';

export const useQrSettings = () => {
  return useQuery({
    queryKey: ['qr-settings'],
    queryFn: async (): Promise<QrMenuSettings> => {
      const response = await api.get('/qr/settings');
      return response.data;
    },
  });
};

export const useCreateQrSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateQrSettingsDto): Promise<QrMenuSettings> => {
      const response = await api.post('/qr/settings', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qr-settings'] });
      toast.success(i18n.t('common:notifications.qrSettingsCreatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.qrSettingsCreateFailed'));
    },
  });
};

export const useUpdateQrSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateQrSettingsDto): Promise<QrMenuSettings> => {
      const response = await api.patch('/qr/settings', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qr-settings'] });
      toast.success(i18n.t('common:notifications.qrSettingsUpdatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.qrSettingsUpdateFailed'));
    },
  });
};

export const useDeleteQrSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      await api.delete('/qr/settings');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qr-settings'] });
      toast.success(i18n.t('common:notifications.qrSettingsResetSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.qrSettingsResetFailed'));
    },
  });
};

interface QrCodesResponse {
  tenant: {
    id: string;
    name: string;
  };
  settings: QrMenuSettings;
  qrCodes: QrCodeData[];
}

export const useQrCodes = () => {
  return useQuery({
    queryKey: ['qr-codes'],
    queryFn: async (): Promise<QrCodesResponse> => {
      const response = await api.get('/qr/codes');
      return response.data;
    },
  });
};
