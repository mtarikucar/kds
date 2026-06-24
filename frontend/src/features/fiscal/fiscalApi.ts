import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/api-error';
import { useBranchScopeStore } from '../../store/branchScopeStore';

export interface FiscalReceiptLine {
  id: string;
  lineNo: number;
  productCode: string;
  name: string;
  qty: number | string;
  unitPriceCents: number;
  vatRate: number;
}

export interface FiscalReceipt {
  id: string;
  tenantId: string;
  orderId: string | null;
  fiscalDeviceId: string;
  providerId: string;
  fiscalNo: string | null;
  status: 'queued' | 'issued' | 'failed' | 'cancelled';
  attempts: number;
  lastError: string | null;
  totalCents: number;
  currency: string;
  vatBreakdown: Record<string, number>;
  createdAt: string;
  lines: FiscalReceiptLine[];
}

export interface FiscalDevice {
  id: string;
  providerId: string;
  branchId: string | null;
  deviceId: string | null;
  serial: string;
  model: string | null;
  capabilities: string[];
  status: string; // offline | online | error | maintenance | retired
  lastSeenAt: string | null;
  createdAt: string;
}

export interface RegisterFiscalDeviceInput {
  providerId: string;
  serial: string;
  model?: string;
  deviceId?: string;
}

export const fiscalKeys = {
  // branchId appended last (convention); `pendingPrefix` is the branch-agnostic
  // prefix used for invalidation, which matches every branch's entry.
  pending: (branchId: string | null) => ['fiscal', 'pending', branchId] as const,
  pendingPrefix: ['fiscal', 'pending'] as const,
  devices: (branchId: string | null) => ['fiscal', 'devices', branchId] as const,
  devicesPrefix: ['fiscal', 'devices'] as const,
};

export const useListFiscalDevices = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: fiscalKeys.devices(branchId),
    queryFn: async (): Promise<FiscalDevice[]> => {
      const r = await api.get('/v1/fiscal/devices');
      return r.data;
    },
  });
};

export const useRegisterFiscalDevice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegisterFiscalDeviceInput): Promise<FiscalDevice> => {
      const r = await api.post('/v1/fiscal/devices', input);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fiscalKeys.devicesPrefix });
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Could not register device')),
  });
};

export const useRetireFiscalDevice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<FiscalDevice> => {
      const r = await api.post(`/v1/fiscal/devices/${id}/retire`);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: fiscalKeys.devicesPrefix });
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Could not retire device')),
  });
};

export const useListPendingReceipts = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: fiscalKeys.pending(branchId),
    queryFn: async (): Promise<FiscalReceipt[]> => {
      const r = await api.get('/v1/fiscal/pending');
      return r.data;
    },
    refetchInterval: 20_000,
  });
};

export const useRetryReceipt = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<FiscalReceipt> => {
      const r = await api.post(`/v1/fiscal/receipts/${id}/retry`);
      return r.data;
    },
    onSuccess: (out) => {
      qc.invalidateQueries({ queryKey: fiscalKeys.pendingPrefix });
      if (out.status === 'issued') toast.success(`Receipt issued (${out.fiscalNo}).`);
      else toast.error(`Retry failed: ${out.lastError ?? 'unknown'}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Retry failed')),
  });
};
