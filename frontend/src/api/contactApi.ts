import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../lib/api';

export interface SubscriptionInquiryRequest {
  planId: string;
  billingCycle: 'MONTHLY' | 'YEARLY';
  preferredMethod?: 'WHATSAPP' | 'EMAIL';
}

export interface UpgradeInquiryRequest {
  subscriptionId: string;
  newPlanId: string;
  billingCycle: 'MONTHLY' | 'YEARLY';
  preferredMethod?: 'WHATSAPP' | 'EMAIL';
}

export interface ContactLinksResponse {
  planName: string;
  billingCycle: string;
  amount: number;
  currency: string;
  whatsappLink: string;
  emailLink: string;
  whatsappNumber: string;
  email: string;
  message: string;
  currentPlanName?: string;
  newPlanName?: string;
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
 * Get contact links for subscription inquiry
 */
export function useGetContactLinks() {
  return useMutation({
    mutationFn: async (
      data: SubscriptionInquiryRequest
    ): Promise<ContactLinksResponse> => {
      const response = await api.post('/contact/subscription-inquiry', data);
      return response.data;
    },
  });
}

/**
 * Get contact links for upgrade inquiry
 */
export function useGetUpgradeContactLinks() {
  return useMutation({
    mutationFn: async (
      data: UpgradeInquiryRequest
    ): Promise<ContactLinksResponse> => {
      const response = await api.post('/contact/upgrade-inquiry', data);
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
