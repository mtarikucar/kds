import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface CallerEvent {
  id: string;
  tenantId: string;
  providerId: string;
  callId: string;
  kind: 'incoming' | 'answered' | 'ended' | 'missed';
  e164: string | null;
  customerId: string | null;
  durationMs: number | null;
  occurredAt: string;
}

export const callerKeys = {
  recent: ['caller', 'recent'] as const,
};

export const useListCallerEvents = (limit = 50) =>
  useQuery({
    queryKey: [...callerKeys.recent, limit],
    queryFn: async (): Promise<CallerEvent[]> => {
      const r = await api.get('/v1/caller/recent', { params: { limit } });
      return r.data;
    },
    refetchInterval: 10_000,
  });
