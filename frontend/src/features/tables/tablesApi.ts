import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Table, CreateTableDto, UpdateTableDto } from '../../types';

export const useTables = () => {
  return useQuery({
    queryKey: ['tables'],
    queryFn: async (): Promise<Table[]> => {
      const response = await api.get('/tables');
      return response.data;
    },
  });
};

export const useTable = (id: string) => {
  return useQuery({
    queryKey: ['tables', id],
    queryFn: async (): Promise<Table> => {
      const response = await api.get(`/tables/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

export const useCreateTable = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateTableDto): Promise<Table> => {
      const response = await api.post('/tables', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success('Table created successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create table');
    },
  });
};

export const useUpdateTable = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateTableDto;
    }): Promise<Table> => {
      const response = await api.patch(`/tables/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success('Table updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update table');
    },
  });
};

export const useDeleteTable = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/tables/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success('Table deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete table');
    },
  });
};

export const useUpdateTableStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: string;
    }): Promise<Table> => {
      const response = await api.patch(`/tables/${id}`, { status });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update table status');
    },
  });
};
