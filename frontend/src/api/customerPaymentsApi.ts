import { useMutation, useQuery } from '@tanstack/react-query';
import api from './axios';

export enum PaymentProvider {
  STRIPE = 'STRIPE',
  IYZICO = 'IYZICO',
}

export interface CreateCustomerPaymentDto {
  orderId: string;
  sessionId: string;
  provider: PaymentProvider;
  tipAmount?: number;
  returnUrl?: string;
  cancelUrl?: string;
}

export interface ConfirmCustomerPaymentDto {
  paymentIntentId: string;
  paymentMethodId?: string;
  conversationId?: string;
}

export interface CustomerPaymentIntentResponse {
  paymentIntentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
  provider: PaymentProvider;
  orderId: string;
  status: string;
  publishableKey?: string;
  checkoutFormContent?: string;
}

export interface CustomerPaymentConfirmationResponse {
  success: boolean;
  orderId: string;
  paymentId: string;
  receiptUrl?: string;
  message: string;
}

export interface PaymentStatusResponse {
  orderId: string;
  orderNumber: string;
  status: string;
  amount: number;
  isPaid: boolean;
  paidAt?: Date;
  payments: any[];
}

/**
 * Create payment intent for customer order
 */
export function useCreateCustomerPaymentIntent() {
  return useMutation({
    mutationFn: async (data: CreateCustomerPaymentDto): Promise<CustomerPaymentIntentResponse> => {
      const response = await api.post('/customer-public/payments/create-intent', data);
      return response.data;
    },
  });
}

/**
 * Confirm customer payment
 */
export function useConfirmCustomerPayment() {
  return useMutation({
    mutationFn: async (data: ConfirmCustomerPaymentDto): Promise<CustomerPaymentConfirmationResponse> => {
      const response = await api.post('/customer-public/payments/confirm', data);
      return response.data;
    },
  });
}

/**
 * Get payment status
 */
export function usePaymentStatus(orderId: string, sessionId: string) {
  return useQuery({
    queryKey: ['paymentStatus', orderId, sessionId],
    queryFn: async (): Promise<PaymentStatusResponse> => {
      const response = await api.get(`/customer-public/payments/status/${orderId}`, {
        params: { sessionId },
      });
      return response.data;
    },
    enabled: !!orderId && !!sessionId,
    refetchInterval: (data) => (data?.isPaid ? false : 3000), // Poll every 3s until paid
  });
}
