import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import { useBranchScopeStore } from '../../store/branchScopeStore';

export interface ActiveTerminal {
  active: boolean;
  providerId?: string;
  activationState?: string;
  simulator?: boolean;
}

export interface TerminalChargeView {
  chargeId: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'TIMEOUT' | 'ERROR' | 'CANCELLED' | 'RECORDED';
  approvalCode: string | null;
  cardBrand: string | null;
  maskedPan: string | null;
  paymentId: string | null;
  error: string | null;
  amount: number;
  orderId: string;
}

/** Whether this branch drives a card terminal (and whether it's a simulator).
 *  When inactive, the POS uses the manual-card flow unchanged. */
export const useActiveTerminal = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['paymentTerminalActive', branchId],
    queryFn: async (): Promise<ActiveTerminal> => {
      const res = await api.get<ActiveTerminal>('/payment-terminal/active');
      return res.data;
    },
    staleTime: 60_000,
  });
};

/** Start a charge on the terminal. Records NOTHING until APPROVED. */
export const startTerminalCharge = async (
  orderId: string,
  amount: number,
  idempotencyKey: string,
): Promise<TerminalChargeView> => {
  const res = await api.post(`/orders/${orderId}/terminal-charge`, {
    amount,
    idempotencyKey,
  });
  return res.data;
};

/** Poll a charge; once APPROVED the backend has recorded the Payment. */
export const pollTerminalCharge = async (
  orderId: string,
  chargeId: string,
): Promise<TerminalChargeView> => {
  const res = await api.get(`/orders/${orderId}/terminal-charge/${chargeId}`);
  return res.data;
};

/** Abort a still-pending charge. */
export const cancelTerminalCharge = async (
  orderId: string,
  chargeId: string,
): Promise<TerminalChargeView> => {
  const res = await api.post(`/orders/${orderId}/terminal-charge/${chargeId}/cancel`);
  return res.data;
};

/** Terminal statuses that close the attempt (stop polling). */
export const isTerminalDone = (s: TerminalChargeView['status']) =>
  s === 'RECORDED' || s === 'DECLINED' || s === 'TIMEOUT' || s === 'ERROR' || s === 'CANCELLED';

// ── Provisioning (admin) ───────────────────────────────────────────────────

export type TerminalActivationState =
  | 'CONFIGURED_NOT_ACTIVE'
  | 'ACTIVE'
  | 'SIMULATOR'
  | 'DISABLED';

export interface TerminalProvider {
  id: string;
  kind: 'bridge' | 'in_process';
  capabilities: string[];
  fiscalCoupled: boolean;
}

export interface TerminalRecord {
  id: string;
  providerId: string;
  providerKind: 'bridge' | 'in_process' | null;
  providerRegistered: boolean;
  capabilities: string[];
  fiscalCoupled: boolean;
  serial: string;
  model: string | null;
  branchId: string | null;
  deviceId: string | null;
  status: string;
  activationState: TerminalActivationState;
  lastSeenAt: string | null;
}

export interface RegisterTerminalInput {
  providerId: string;
  serial: string;
  model?: string;
  deviceId?: string;
  config?: Record<string, unknown>;
}

export const useTerminalProviders = () =>
  useQuery({
    queryKey: ['terminalProviders'],
    queryFn: async (): Promise<TerminalProvider[]> => {
      const res = await api.get<TerminalProvider[]>('/payment-terminal/providers');
      return res.data;
    },
    staleTime: 5 * 60_000,
  });

export const useTerminals = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['paymentTerminals', branchId],
    queryFn: async (): Promise<TerminalRecord[]> => {
      const res = await api.get<TerminalRecord[]>('/payment-terminal/terminals');
      return res.data;
    },
  });
};

const useInvalidateTerminals = () => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['paymentTerminals'] });
    void qc.invalidateQueries({ queryKey: ['paymentTerminalActive'] });
  };
};

export const useRegisterTerminal = () => {
  const invalidate = useInvalidateTerminals();
  return useMutation({
    mutationFn: async (input: RegisterTerminalInput): Promise<TerminalRecord> => {
      const res = await api.post('/payment-terminal/terminals', input);
      return res.data;
    },
    onSuccess: invalidate,
  });
};

export const useSetTerminalActivation = () => {
  const invalidate = useInvalidateTerminals();
  return useMutation({
    mutationFn: async (vars: {
      id: string;
      activationState: TerminalActivationState;
    }): Promise<TerminalRecord> => {
      const res = await api.patch(
        `/payment-terminal/terminals/${vars.id}/activation`,
        { activationState: vars.activationState },
      );
      return res.data;
    },
    onSuccess: invalidate,
  });
};

export interface ReconciliationCharge {
  chargeId: string;
  orderId: string;
  providerId: string;
  status: string;
  amount: number;
  approvalCode: string | null;
  rrn: string | null;
  recoveryAttempts: number;
  error: string | null;
  createdAt: string;
}

/** Charges needing operator attention (approved-unrecorded / needs-review). */
export const useTerminalReconciliation = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['paymentTerminalReconciliation', branchId],
    queryFn: async (): Promise<ReconciliationCharge[]> => {
      const res = await api.get<ReconciliationCharge[]>('/payment-terminal/reconciliation');
      return res.data;
    },
  });
};

export const useRemoveTerminal = () => {
  const invalidate = useInvalidateTerminals();
  return useMutation({
    mutationFn: async (id: string): Promise<{ id: string; retired: boolean }> => {
      const res = await api.delete(`/payment-terminal/terminals/${id}`);
      return res.data;
    },
    onSuccess: invalidate,
  });
};
