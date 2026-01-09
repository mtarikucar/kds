import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export interface CreatePaymentIntentRequest {
  planId: string;
  billingCycle: 'MONTHLY' | 'YEARLY';
}

export interface CreatePlanChangeIntentRequest {
  pendingChangeId: string;
}

export interface CreatePaymentIntentResponse {
  provider: 'PAYTR' | 'EMAIL';
  paymentLink?: string;        // PayTR
  merchantOid?: string;        // PayTR
  message?: string;            // EMAIL provider
  amount: number;
  currency: string;
}

export interface ConfirmPaymentRequest {
  paymentIntentId: string;
  paymentMethodId?: string;
}

export interface ConfirmPaymentResponse {
  success: boolean;
  message: string;
  subscriptionId?: string;
  invoiceId?: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  subscriptionId: string;
  status: string;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  dueDate?: string;
  paidAt?: string;
  pdfUrl?: string;
  description?: string;
  createdAt: string;
}

/**
 * Create payment intent for a subscription
 */
export function useCreatePaymentIntent() {
  return useMutation({
    mutationFn: async (
      data: CreatePaymentIntentRequest
    ): Promise<CreatePaymentIntentResponse> => {
      const response = await api.post('/payments/create-intent', data);
      return response.data;
    },
  });
}

/**
 * Create payment intent for plan change
 */
export function useCreatePlanChangeIntent() {
  return useMutation({
    mutationFn: async (
      data: CreatePlanChangeIntentRequest
    ): Promise<CreatePaymentIntentResponse> => {
      const response = await api.post('/payments/create-plan-change-intent', data);
      return response.data;
    },
  });
}

/**
 * Confirm payment (PayTR uses redirect flow and webhook for confirmation)
 */
export function useConfirmPayment() {
  return useMutation({
    mutationFn: async (
      data: ConfirmPaymentRequest
    ): Promise<ConfirmPaymentResponse> => {
      const response = await api.post('/payments/confirm-payment', data);
      return response.data;
    },
  });
}

/**
 * Get invoice by ID
 */
export function useInvoice(invoiceId: string) {
  return useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: async (): Promise<Invoice> => {
      const response = await api.get(`/invoices/${invoiceId}`);
      return response.data;
    },
    enabled: !!invoiceId,
  });
}

/**
 * Download invoice
 */
export function downloadInvoice(invoiceId: string) {
  window.open(`${api.defaults.baseURL}/invoices/${invoiceId}/download`, '_blank');
}

/**
 * Generate invoice PDF
 */
export function useGenerateInvoicePdf() {
  return useMutation({
    mutationFn: async (invoiceId: string): Promise<{ success: boolean; pdfUrl: string }> => {
      const response = await api.post(`/invoices/${invoiceId}/generate-pdf`);
      return response.data;
    },
  });
}
