import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';
import { subscriptionKeys } from '../features/subscriptions/subscriptionsApi';

export type BillingCycle = 'MONTHLY' | 'YEARLY';

export interface CreateIntentRequest {
  planId: string;
  billingCycle: BillingCycle;
  /**
   * IDs of the three current legal documents (KVKK + Mesafeli Satış +
   * İade Politikası) the user just checked at checkout. Backend
   * verifies these match the current `isCurrent=true` rows and writes
   * three audit Consent rows before minting a PayTR token. Required —
   * backend 400s with code `LEGAL_CONSENT_REQUIRED` if omitted.
   */
  acceptedDocumentIds: string[];
}

export interface CreateIntentResponse {
  provider: 'PAYTR' | 'TRIAL';
  paymentLink?: string;
  merchantOid?: string;
  amount: number;
  currency: string;
  // Set when the backend short-circuited to a trial activation (no
  // charge). The TRIALING subscription is already provisioned.
  trialActivated?: boolean;
}

/**
 * Reserve a PayTR payment intent for a subscription purchase / upgrade.
 * Backend creates a PENDING SubscriptionPayment + optional
 * PendingPlanChange and returns the hosted-iframe `paymentLink` to
 * redirect the user to. The webhook flips status to ACTIVE on success.
 */
export const createPaymentIntent = async (
  body: CreateIntentRequest,
): Promise<CreateIntentResponse> => {
  const response = await api.post('/payments/create-intent', body);
  return response.data;
};

export const useCreatePaymentIntent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPaymentIntent,
    // Trial activation flips the subscription to TRIALING server-side
    // *before* this mutation returns; invalidate the relevant caches so
    // any open page (sidebar, settings, plan card) re-renders with the
    // new state. Same for the PayTR branch — the activated sub appears
    // moments later via webhook and we don't want a stale free-plan
    // banner lingering in the background tab.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.effectiveFeatures() });
    },
  });
};

// --- Bank transfer (Havale / EFT) ---------------------------------------

export interface BankTransferDetails {
  /** Master switch — superadmin must turn the channel on before tenants
   * can pick "Havale / EFT" at checkout. When false the option is hidden. */
  enabled: boolean;
  bankName: string | null;
  accountHolder: string | null;
  iban: string | null;
  instructions: string | null;
}

export interface BankTransferIntentResponse {
  provider: 'BANK_TRANSFER';
  /** Unique reference code the tenant must put in the transfer description
   * so the team can match the incoming payment. Shown prominently. */
  reference: string;
  amount: number;
  currency: string;
  planName: string;
  bankDetails: {
    bankName: string | null;
    accountHolder: string | null;
    iban: string | null;
    instructions: string | null;
  };
}

/**
 * Read the public bank-transfer details (which account to wire to + free
 * text instructions) and whether the channel is enabled at all. Drives
 * whether the "Havale / EFT" option is offered at checkout.
 */
export const useBankTransferDetails = () => {
  return useQuery({
    queryKey: ['payments', 'bank-transfer', 'details'],
    queryFn: async (): Promise<BankTransferDetails> => {
      const response = await api.get('/payments/bank-transfer/details');
      return response.data;
    },
    // The havale channel is a low-churn superadmin toggle, but it must not
    // stay stale indefinitely: a 60s window means a superadmin enabling the
    // channel reflects at checkout within a minute without hammering the
    // endpoint on every mount/refocus.
    staleTime: 60_000,
  });
};

/**
 * Reserve a bank-transfer payment intent. Backend creates a PENDING
 * SubscriptionPayment (awaiting manual confirmation) and echoes back the
 * reference code + bank details to display. Access is granted only once a
 * superadmin confirms the wire landed. Shares the same consent contract as
 * the card flow (acceptedDocumentIds verified server-side).
 */
export const useCreateBankTransferIntent = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      body: CreateIntentRequest,
    ): Promise<BankTransferIntentResponse> => {
      const response = await api.post('/payments/bank-transfer/intent', body);
      return response.data;
    },
    // The PENDING payment doesn't unlock the plan yet, but the subscription
    // row may flip to a PENDING/awaiting state server-side; refresh the
    // relevant caches so any open page reflects the new pending payment.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.effectiveFeatures() });
    },
  });
};

/**
 * Trigger a browser download for an invoice PDF. We can't use
 * `window.open` because the endpoint sits behind JwtAuthGuard and
 * window.open doesn't propagate Authorization headers — the user
 * would get a 401. Instead, fetch the bytes through the authed axios
 * client, wrap in a Blob, and trigger a hidden <a download> click.
 */
export const downloadInvoice = async (invoiceNumber: string): Promise<void> => {
  const response = await api.get(`/invoices/${invoiceNumber}/download`, {
    responseType: 'blob',
  });
  const blob = new Blob([response.data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `invoice-${invoiceNumber}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick so the click handler has time to consume it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
