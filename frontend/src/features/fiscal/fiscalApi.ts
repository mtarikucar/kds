import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';

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

export const fiscalKeys = {
  pending: ['fiscal', 'pending'] as const,
};

export const useListPendingReceipts = () =>
  useQuery({
    queryKey: fiscalKeys.pending,
    queryFn: async (): Promise<FiscalReceipt[]> => {
      const r = await api.get('/v1/fiscal/pending');
      return r.data;
    },
    refetchInterval: 20_000,
  });

export const useRetryReceipt = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<FiscalReceipt> => {
      const r = await api.post(`/v1/fiscal/receipts/${id}/retry`);
      return r.data;
    },
    onSuccess: (out) => {
      qc.invalidateQueries({ queryKey: fiscalKeys.pending });
      if (out.status === 'issued') toast.success(`Receipt issued (${out.fiscalNo}).`);
      else toast.error(`Retry failed: ${out.lastError ?? 'unknown'}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Retry failed'),
  });
};
