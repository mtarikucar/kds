import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getApiErrorMessage } from '../../../lib/api-error';
import { superAdminApi as api } from './superAdminApi';

/**
 * SuperAdmin bank-transfer (havale/EFT) management.
 *
 * Two surfaces share one query namespace ('sa', 'bank-transfer', …):
 *   - settings: the operator-editable bank details + enable toggle that the
 *     tenant checkout reads back when offering manual bank transfer.
 *   - pending: payments awaiting manual reconciliation; confirming one
 *     activates the underlying subscription, rejecting one releases it.
 *
 * Mutations invalidate the relevant cache and toast through the shared
 * getApiErrorMessage pipeline so failures surface consistently with the
 * rest of the superadmin feature modules.
 */

export interface BankTransferSettings {
  id: string;
  enabled: boolean;
  bankName: string | null;
  accountHolder: string | null;
  iban: string | null;
  instructions: string | null;
  updatedByEmail: string | null;
  updatedAt: string;
}

export interface UpdateBankTransferSettingsDto {
  enabled?: boolean;
  bankName?: string | null;
  accountHolder?: string | null;
  iban?: string | null;
  instructions?: string | null;
}

export interface PendingBankTransfer {
  id: string;
  amount: number;
  currency: string;
  externalReference: string | null;
  createdAt: string;
  subscription: {
    id: string;
    billingCycle: 'MONTHLY' | 'YEARLY';
    plan: { name: string; displayName: string; currency: string };
    tenant: { id: string; name: string };
  };
}

export const saBankTransferKeys = {
  settings: () => ['sa', 'bank-transfer', 'settings'] as const,
  pending: () => ['sa', 'bank-transfer', 'pending'] as const,
};

// ── Settings ───────────────────────────────────────────────────────────

export const useBankTransferSettings = () =>
  useQuery({
    queryKey: saBankTransferKeys.settings(),
    queryFn: async (): Promise<BankTransferSettings> => {
      const r = await api.get('/superadmin/bank-transfer/settings');
      return r.data;
    },
  });

export const useUpdateBankTransferSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateBankTransferSettingsDto): Promise<BankTransferSettings> => {
      const r = await api.patch('/superadmin/bank-transfer/settings', body);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: saBankTransferKeys.settings() });
      toast.success('Havale ayarları kaydedildi.');
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Kaydetme başarısız oldu.')),
  });
};

// ── Pending transfers ──────────────────────────────────────────────────

export const usePendingBankTransfers = () =>
  useQuery({
    queryKey: saBankTransferKeys.pending(),
    queryFn: async (): Promise<PendingBankTransfer[]> => {
      const r = await api.get('/superadmin/bank-transfer/pending');
      return r.data;
    },
  });

export const useConfirmBankTransfer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (paymentId: string) => {
      const r = await api.post(`/superadmin/bank-transfer/${paymentId}/confirm`);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: saBankTransferKeys.pending() });
      qc.invalidateQueries({ queryKey: ['superadmin', 'subscriptions'] });
      toast.success('Havale onaylandı, abonelik etkinleştirildi.');
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Onaylama başarısız oldu.')),
  });
};

export const useRejectBankTransfer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ paymentId, reason }: { paymentId: string; reason?: string }) => {
      const r = await api.post(`/superadmin/bank-transfer/${paymentId}/reject`, { reason });
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: saBankTransferKeys.pending() });
      toast.success('Havale reddedildi.');
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Reddetme başarısız oldu.')),
  });
};
