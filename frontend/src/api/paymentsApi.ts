import { useMutation, useQueryClient } from '@tanstack/react-query';
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
