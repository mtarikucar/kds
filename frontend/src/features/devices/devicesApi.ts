import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';

export type DeviceKind =
  | 'tablet_waiter'
  | 'tablet_customer'
  | 'kds_screen'
  | 'bar_screen'
  | 'pos_terminal'
  | 'yazarkasa'
  | 'receipt_printer'
  | 'kitchen_printer'
  | 'caller_id'
  | 'scanner'
  | 'local_bridge';

export interface Device {
  id: string;
  tenantId: string;
  branchId: string | null;
  kind: DeviceKind;
  capabilities: string[];
  status: string;
  lastSeenAt: string | null;
  serial: string | null;
  model: string | null;
  ownership: 'sold' | 'rented' | 'byo';
  pairCode?: string | null;
  pairCodeExpiresAt?: string | null;
  warrantyUntil?: string | null;
}

export interface DeviceCommand {
  id: string;
  deviceId: string;
  kind: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
}

export const deviceKeys = {
  all: ['devices'] as const,
  list: (filters: Record<string, string | undefined>) => [...deviceKeys.all, 'list', filters] as const,
  commands: (deviceId: string) => [...deviceKeys.all, deviceId, 'commands'] as const,
};

export const useListDevices = (filters: { branchId?: string; kind?: string; status?: string } = {}) =>
  useQuery({
    queryKey: deviceKeys.list(filters),
    queryFn: async (): Promise<Device[]> => {
      const r = await api.get('/v1/devices', { params: filters });
      return r.data;
    },
    refetchInterval: 15_000,  // poll for status changes
  });

export const useCreateDeviceSlot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: DeviceKind; branchId?: string; capabilities?: string[]; model?: string }): Promise<Device> => {
      const r = await api.post('/v1/devices', input);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deviceKeys.all });
      toast.success('Device slot created. Use the pair code on the device.');
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Failed to create slot'),
  });
};

export const useRetireDevice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Device> => {
      const r = await api.delete(`/v1/devices/${id}`);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deviceKeys.all });
      toast.success('Device retired');
    },
  });
};

export const useListDeviceCommands = (deviceId: string, status?: string) =>
  useQuery({
    queryKey: [...deviceKeys.commands(deviceId), status],
    queryFn: async (): Promise<DeviceCommand[]> => {
      const r = await api.get(`/v1/devices/${deviceId}/commands`, { params: { status, limit: 100 } });
      return r.data;
    },
    enabled: !!deviceId,
    refetchInterval: 10_000,
  });

export const useEnqueueCommand = (deviceId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: string; payload: Record<string, unknown>; priority?: number; idempotencyKey?: string }): Promise<DeviceCommand> => {
      const r = await api.post(`/v1/devices/${deviceId}/commands`, input);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: deviceKeys.commands(deviceId) }),
  });
};
