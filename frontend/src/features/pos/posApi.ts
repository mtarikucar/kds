import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { PosSettings, UpdatePosSettingsDto } from '../../types';

// Fetch POS settings for current tenant
export const useGetPosSettings = () => {
  return useQuery<PosSettings>({
    queryKey: ['posSettings'],
    queryFn: async () => {
      const response = await api.get('/pos-settings');
      return response.data;
    },
  });
};

// Update POS settings
export const useUpdatePosSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdatePosSettingsDto) => {
      const response = await api.patch('/pos-settings', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['posSettings'] });
    },
  });
};
