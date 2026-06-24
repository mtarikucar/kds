import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import { Table, CreateTableDto, UpdateTableDto, MergeTablesDto, UnmergeTableDto, TableGroupInfo } from '../../types';

export const useTables = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['tables', branchId],
    queryFn: async (): Promise<Table[]> => {
      const response = await api.get<Table[]>('/tables');
      return response.data;
    },
  });
};

export const useTable = (id: string) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['tables', id, branchId],
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
      toast.success(i18n.t('common:notifications.tableCreatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
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
      toast.success(i18n.t('common:notifications.tableUpdatedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
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
      toast.success(i18n.t('common:notifications.tableDeletedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
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
      const response = await api.patch(`/tables/${id}/status`, { status });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      // The live floor map (GET /floor-plan) carries table status too — recolor
      // it immediately on this client (the backend also emits floor:layout-
      // updated for other terminals).
      queryClient.invalidateQueries({ queryKey: ['floorPlan'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

// ========================================
// TABLE MERGE / SPLIT
// ========================================

export const useMergeTables = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: MergeTablesDto): Promise<TableGroupInfo> => {
      const response = await api.post('/tables/merge', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('pos:tableMerge.mergeSuccess'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useUnmergeTable = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UnmergeTableDto): Promise<void> => {
      await api.post('/tables/unmerge', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('pos:tableMerge.unmergeSuccess'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useUnmergeAll = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (groupId: string): Promise<void> => {
      await api.post(`/tables/unmerge-all/${groupId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('pos:tableMerge.unmergeAllSuccess'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};

export const useTableGroup = (groupId: string | null) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['tableGroup', groupId, branchId],
    queryFn: async (): Promise<TableGroupInfo> => {
      const response = await api.get(`/tables/group/${groupId}`);
      return response.data;
    },
    enabled: !!groupId,
  });
};
