import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/api-error';

export interface Branch {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  timezone: string;
  address: Record<string, unknown> | null;
  status: 'active' | 'suspended' | 'archived';
  createdAt: string;
}

export const branchKeys = {
  all: ['branches'] as const,
};

export const useListBranches = () =>
  useQuery({
    queryKey: branchKeys.all,
    queryFn: async (): Promise<Branch[]> => {
      const r = await api.get('/v1/branches');
      return r.data;
    },
  });

export const useCreateBranch = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name?: string; code?: string; timezone?: string; address?: Record<string, unknown> }): Promise<Branch> => {
      const r = await api.post('/v1/branches', input);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: branchKeys.all });
      toast.success('Branch created.');
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Failed')),
  });
};
