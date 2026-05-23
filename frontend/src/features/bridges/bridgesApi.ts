import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';

export interface LocalBridge {
  id: string;
  tenantId: string;
  branchId: string;
  hostname: string | null;
  os: string | null;
  agentVersion: string | null;
  status: 'claiming' | 'online' | 'offline' | 'retired';
  lastSeenAt: string | null;
  provisionedAt: string | null;
  productSku: string | null;
  createdAt: string;
  // Set on the create-response only (one-time).
  provisioningToken?: string;
}

export const bridgeKeys = {
  all: ['bridges'] as const,
};

export const useListBridges = (branchId?: string) =>
  useQuery({
    queryKey: [...bridgeKeys.all, branchId],
    queryFn: async (): Promise<LocalBridge[]> => {
      const r = await api.get('/v1/bridges', { params: branchId ? { branchId } : {} });
      return r.data;
    },
    refetchInterval: 20_000,
  });

export const useCreateBridge = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { branchId: string; productSku?: string; hostname?: string }): Promise<LocalBridge> => {
      const r = await api.post('/v1/bridges', input);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: bridgeKeys.all });
      toast.success('Bridge provisioned — copy the token before closing.');
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Failed'),
  });
};

export const useRetireBridge = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/v1/bridges/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: bridgeKeys.all }),
  });
};
