import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface BranchHealth {
  id: string;
  name: string;
  health: {
    branchId: string;
    score: number;
    pill: 'green' | 'yellow' | 'red';
    breakdown: {
      devicesOnlinePct: number;
      fiscalAgeMinutes: number | null;
      orderAgeMinutes: number | null;
    };
    countedDevices: number;
  };
}

export const healthKeys = {
  overview: ['health', 'overview'] as const,
};

export const useGetHealthOverview = () =>
  useQuery({
    queryKey: healthKeys.overview,
    queryFn: async (): Promise<BranchHealth[]> => {
      const r = await api.get('/v1/health/branches');
      return r.data;
    },
    refetchInterval: 30_000,
  });
