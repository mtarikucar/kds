import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { API_URL } from '../../lib/env';

export interface CustomerPayableItem {
  orderItemId: string;
  productName: string | null;
  quantity: number;
  paidQuantity: number;
  remainingQuantity: number;
  unitTotal: string;
  itemTotal: string;
  modifierLabels: string[];
}

export interface CustomerPayableOrder {
  orderId: string;
  orderNumber: string;
  finalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  items: CustomerPayableItem[];
}

export interface CustomerPayableSummary {
  sessionId: string;
  tableId: string | null;
  orders: CustomerPayableOrder[];
  summary: {
    totalAmount: string;
    paidAmount: string;
    remainingAmount: string;
    remainingQuantity: number;
  };
}

export interface PayIntentRequest {
  items: Array<{ orderItemId: string; quantity: number }>;
  customerPhone?: string;
}

export interface PayIntentResponse {
  merchantOid: string;
  paymentLink: string;
  amount: string;
  currency: string;
}

export interface PayStatusResponse {
  merchantOid: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';
  amount: string;
  failureReason: string | null;
  remaining: CustomerPayableSummary;
}

const base = (sessionId: string) =>
  `${API_URL}/customer-orders/sessions/${sessionId}`;

/**
 * Table-wide payable items for the customer's session. The server
 * resolves tenantId from sessionId — the client never sends tenantId.
 */
export const useSessionPayableItems = (sessionId: string | null) => {
  return useQuery({
    queryKey: ['sessionPayableItems', sessionId],
    queryFn: async (): Promise<CustomerPayableSummary> => {
      const response = await axios.get(`${base(sessionId!)}/payable-items`);
      return response.data;
    },
    enabled: !!sessionId,
    // Customer socket pushes order:status-updated which the QR menu's
    // existing useCustomerSocket invalidates ['customerOrders']; pair it
    // with refetch on focus so a returning-from-PayTR window sees fresh state.
    refetchOnWindowFocus: true,
  });
};

/**
 * Create a PayTR self-pay intent + redirect the user to the hosted
 * iFrame. The server derives amount; client cannot tamper.
 */
export const useCreatePayIntent = () => {
  return useMutation({
    mutationFn: async ({
      sessionId,
      ...body
    }: PayIntentRequest & { sessionId: string }): Promise<PayIntentResponse> => {
      const response = await axios.post(`${base(sessionId)}/pay-intent`, body);
      return response.data;
    },
  });
};

/**
 * Poll the PendingSelfPayment status after the PayTR redirect lands
 * on the payment-result page. Returns the updated payable-items
 * summary so the UI can show "you paid X, remaining Y" right away.
 */
export const useSessionPayStatus = (
  sessionId: string | null,
  merchantOid: string | null,
  enabled: boolean,
) => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['sessionPayStatus', sessionId, merchantOid],
    queryFn: async (): Promise<PayStatusResponse> => {
      const response = await axios.get(`${base(sessionId!)}/pay-status`, {
        params: { oid: merchantOid },
      });
      // Once we've terminalized, invalidate the cached payable-items
      // so subsequent reads (and a re-open of the modal) see fresh data.
      if (
        response.data?.status === 'SUCCEEDED' ||
        response.data?.status === 'FAILED'
      ) {
        queryClient.invalidateQueries({
          queryKey: ['sessionPayableItems', sessionId],
        });
      }
      return response.data;
    },
    enabled: enabled && !!sessionId && !!merchantOid,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Stop polling once we hit a terminal state.
      return status === 'SUCCEEDED' || status === 'FAILED' ? false : 2000;
    },
  });
};
