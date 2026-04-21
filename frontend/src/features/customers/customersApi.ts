import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import { toArrayPayload } from '../../lib/payload';
import { Customer } from '../../types';

export const useCustomers = () => {
  return useQuery({
    queryKey: ['customers'],
    queryFn: async (): Promise<Customer[]> => {
      // Backend returns `{ data: Customer[], total, page, pageSize }`.
      // Unwrap here so pages like CustomersPage — which is eager-loaded
      // and lives in the MAIN bundle — can call `.filter` directly.
      // Before this, `const { data: customers = [] } = useCustomers()`
      // destructured the envelope object (not the array) into `customers`
      // and the first `.filter` on render crashed the whole shell with
      // "TypeError: n.filter is not a function".
      const response = await api.get('/customers');
      return toArrayPayload<Customer>(response.data);
    },
  });
};

export const useCustomer = (id: string) => {
  return useQuery({
    queryKey: ['customer', id],
    queryFn: async () => {
      const response = await api.get(`/customers/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

export const useCreateCustomer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: any) => {
      const response = await api.post('/customers', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(i18n.t('common:notifications.customerCreatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useUpdateCustomer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const response = await api.patch(`/customers/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(i18n.t('common:notifications.customerUpdatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useDeleteCustomer = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.delete(`/customers/${id}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(i18n.t('common:notifications.customerDeletedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};
