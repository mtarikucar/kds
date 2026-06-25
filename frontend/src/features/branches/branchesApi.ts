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
  isHeadquarters?: boolean;
  createdAt: string;
}

export interface BranchOverviewItem {
  id: string;
  name: string;
  code: string | null;
  timezone: string;
  status: 'active' | 'suspended' | 'archived';
  isHeadquarters: boolean;
  createdAt: string;
  devices: { total: number; online: number; pending: number };
  bridges: number;
}

export interface BranchNetworkDevice {
  id: string;
  kind: string;
  status: string;
  bridgeId: string | null;
  serial: string | null;
  model: string | null;
  lastSeenAt: string | null;
}

export interface BranchNetwork {
  bridges: Array<{
    id: string;
    hostname: string | null;
    productSku: string | null;
    status: string;
    agentVersion: string | null;
    lastSeenAt: string | null;
    devices: BranchNetworkDevice[];
  }>;
  cloudDirect: BranchNetworkDevice[];
}

export const branchKeys = {
  all: ['branches'] as const,
  overview: ['branches', 'overview'] as const,
  network: (id: string) => ['branches', id, 'network'] as const,
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

export const useUpdateBranch = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: string;
      input: { name?: string; code?: string; timezone?: string; status?: string };
    }): Promise<Branch> => {
      const r = await api.patch(`/v1/branches/${vars.id}`, vars.input);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: branchKeys.all });
    },
  });
};

/** Branch hub cards: every branch (Merkez/HQ first) with device + bridge tallies. */
export const useBranchOverview = () =>
  useQuery({
    queryKey: branchKeys.overview,
    queryFn: async (): Promise<BranchOverviewItem[]> => {
      const r = await api.get('/v1/branches/overview');
      return r.data;
    },
    refetchInterval: 20_000,
  });

/** A branch's local-network topology (bridges + devices behind each + cloud-direct). */
export const useBranchNetwork = (branchId: string | undefined) =>
  useQuery({
    queryKey: branchKeys.network(branchId ?? ''),
    enabled: !!branchId,
    queryFn: async (): Promise<BranchNetwork> => {
      const r = await api.get(`/v1/branches/${branchId}/network`);
      return r.data;
    },
    refetchInterval: 20_000,
  });

/** Single branch (detail page header). */
export const useGetBranch = (branchId: string | undefined) =>
  useQuery({
    queryKey: [...branchKeys.all, branchId],
    enabled: !!branchId,
    queryFn: async (): Promise<Branch> => {
      const r = await api.get(`/v1/branches/${branchId}`);
      return r.data;
    },
  });
