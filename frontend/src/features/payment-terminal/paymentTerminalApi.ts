import { useQuery } from '@tanstack/react-query';
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
