import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import { getApiErrorMessage } from '../../lib/api-error';

export const useMyProfile = () => {
  return useQuery({
    queryKey: ['my-profile'],
    queryFn: async () => {
      const response = await api.get('/users/me/profile');
      return response.data;
    },
  });
};

/**
 * @param options.silent — suppress the built-in success/error toasts so the
 *   caller can own all feedback (used by the actionable-error inline-fix flow,
 *   which shows its own inline error and resumes the original action on
 *   success). The cache invalidation always runs.
 */
export const useUpdateProfile = (options?: { silent?: boolean }) => {
  const queryClient = useQueryClient();
  const silent = options?.silent ?? false;

  return useMutation({
    mutationFn: async (data: { firstName?: string; lastName?: string; phone?: string }) => {
      const response = await api.patch('/users/me/profile', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      if (!silent) toast.success(i18n.t('common:notifications.profileUpdatedSuccessfully'));
    },
    onError: (error) => {
      if (!silent) toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};

export const useUpdateEmail = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { email: string; currentPassword: string }) => {
      const response = await api.patch('/users/me/email', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      toast.success(i18n.t('common:notifications.updatedSuccessfully'));
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, i18n.t('common:notifications.operationFailed')));
    },
  });
};
