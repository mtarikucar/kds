import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import { toArrayPayload } from '../../lib/payload';
import {
  Order,
  CreateOrderDto,
  UpdateOrderDto,
  UpdateOrderStatusDto,
  CreatePaymentDto,
  Payment,
  OrderFilters,
  WaiterRequest,
  BillRequest,
  SplitBillDto,
  GroupBillSummary,
} from '../../types';

export const useOrders = (filters?: OrderFilters) => {
  return useQuery({
    queryKey: ['orders', filters],
    queryFn: async (): Promise<Order[]> => {
      const response = await api.get('/orders', { params: filters });
      // Tolerate both bare-array and `{ data, meta }` envelope shapes;
      // fall back to `[]` on anything else so downstream `.filter/.map`
      // calls stay safe if the contract drifts again.
      return toArrayPayload<Order>(response.data);
    },
  });
};

export const useOrder = (id: string) => {
  return useQuery({
    queryKey: ['orders', id],
    queryFn: async (): Promise<Order> => {
      const response = await api.get(`/orders/${id}`);
      return response.data;
    },
    enabled: !!id,
  });
};

export const useCreateOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateOrderDto): Promise<Order> => {
      const response = await api.post('/orders', data);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate all order queries (including filtered ones)
      queryClient.invalidateQueries({ 
        queryKey: ['orders'],
        refetchType: 'all' 
      });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('pos:orderCreated'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('pos:orderCreateFailed'));
    },
  });
};

export const useUpdateOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateOrderDto;
    }): Promise<Order> => {
      const response = await api.patch(`/orders/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate all order queries (including filtered ones)
      queryClient.invalidateQueries({ 
        queryKey: ['orders'],
        refetchType: 'all' 
      });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('pos:orderUpdated'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('pos:orderUpdateFailed'));
    },
  });
};

export const useUpdateOrderStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateOrderStatusDto;
    }): Promise<Order> => {
      // Use KDS endpoint for real-time updates with WebSocket emission
      const response = await api.patch(`/kds/orders/${id}/status`, data);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate all order queries (including filtered ones)
      queryClient.invalidateQueries({ 
        queryKey: ['orders'],
        refetchType: 'all' 
      });
      toast.success(i18n.t('pos:orderUpdated'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('pos:orderUpdateFailed'));
    },
  });
};

export const useCancelOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<Order> => {
      const response = await api.patch(`/orders/${id}/status`, { status: 'CANCELLED' });
      return response.data;
    },
    onSuccess: () => {
      // Invalidate all order queries (including filtered ones)
      queryClient.invalidateQueries({ 
        queryKey: ['orders'],
        refetchType: 'all' 
      });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('pos:orderCancelled'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('pos:orderCancelFailed'));
    },
  });
};

export const useCancelKdsOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<Order> => {
      // Use KDS-specific cancel endpoint with WebSocket emission
      const response = await api.patch(`/kds/orders/${id}/cancel`);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate all order queries (including filtered ones)
      queryClient.invalidateQueries({ 
        queryKey: ['orders'],
        refetchType: 'all' 
      });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('pos:orderCancelled'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('pos:orderCancelFailed'));
    },
  });
};

export const useCreatePayment = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreatePaymentDto): Promise<Payment> => {
      const { orderId, ...paymentData } = data;
      const response = await api.post(`/orders/${orderId}/payments`, paymentData);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate all order queries (including filtered ones)
      queryClient.invalidateQueries({
        queryKey: ['orders'],
        refetchType: 'all'
      });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      // Invalidate customer queries since payment may link to customer
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer'] });
      toast.success(i18n.t('pos:paymentRecorded'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('pos:paymentRecordFailed'));
    },
  });
};

// ========================================
// SPLIT BILL
// ========================================

export const useSplitBill = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: SplitBillDto & { orderId: string }) => {
      const { orderId, ...body } = data;
      const response = await api.post(`/orders/${orderId}/payments/split`, body);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['tableGroup'] });
      toast.success(i18n.t('pos:billSplit.splitSuccess'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('pos:billSplit.splitFailed'));
    },
  });
};

export const useGroupBillSummary = (groupId: string | null) => {
  return useQuery({
    queryKey: ['groupBillSummary', groupId],
    queryFn: async (): Promise<GroupBillSummary> => {
      const response = await api.get(`/orders/group-bill-summary/${groupId}`);
      return response.data;
    },
    enabled: !!groupId,
  });
};

// ========================================
// CUSTOMER ORDERS - STAFF HOOKS
// ========================================

export const usePendingOrders = () => {
  return useQuery({
    queryKey: ['orders', 'pending'],
    queryFn: async (): Promise<Order[]> => {
      const response = await api.get('/orders', {
        params: { status: 'PENDING_APPROVAL' },
      });
      return toArrayPayload<Order>(response.data);
    },
    // Real-time updates via Socket.IO - no polling needed
  });
};

export const useApproveOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string): Promise<Order> => {
      const response = await api.post(`/orders/${orderId}/approve`);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate all order queries (including filtered ones)
      queryClient.invalidateQueries({ 
        queryKey: ['orders'],
        refetchType: 'all' 
      });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('common:notifications.orderApprovedSuccessfully'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.orderApproveFailed'));
    },
  });
};

// ========================================
// WAITER REQUESTS - STAFF HOOKS
// ========================================

export const useWaiterRequests = () => {
  return useQuery({
    queryKey: ['waiterRequests'],
    queryFn: async (): Promise<WaiterRequest[]> => {
      const response = await api.get('/customer-orders/waiter-requests/tenant/active');
      return toArrayPayload<WaiterRequest>(response.data);
    },
    // Real-time updates delivered via Socket.IO (see usePosSocket).
  });
};

export const useAcknowledgeWaiterRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestId: string): Promise<WaiterRequest> => {
      const response = await api.patch(`/customer-orders/waiter-requests/${requestId}/acknowledge`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['waiterRequests'],
        refetchType: 'all'
      });
      toast.success(i18n.t('common:notifications.waiterRequestAcknowledged'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.requestAcknowledgeFailed'));
    },
  });
};

export const useCompleteWaiterRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestId: string): Promise<WaiterRequest> => {
      const response = await api.patch(`/customer-orders/waiter-requests/${requestId}/complete`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['waiterRequests'],
        refetchType: 'all'
      });
      toast.success(i18n.t('common:notifications.waiterRequestCompleted'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.requestCompleteFailed'));
    },
  });
};

// ========================================
// BILL REQUESTS - STAFF HOOKS
// ========================================

export const useBillRequests = () => {
  return useQuery({
    queryKey: ['billRequests'],
    queryFn: async (): Promise<BillRequest[]> => {
      const response = await api.get('/customer-orders/bill-requests/tenant/active');
      return toArrayPayload<BillRequest>(response.data);
    },
    // Real-time updates delivered via Socket.IO (see usePosSocket).
  });
};

export const useAcknowledgeBillRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestId: string): Promise<BillRequest> => {
      const response = await api.patch(`/customer-orders/bill-requests/${requestId}/acknowledge`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['billRequests'],
        refetchType: 'all'
      });
      toast.success(i18n.t('common:notifications.billRequestAcknowledged'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.requestAcknowledgeFailed'));
    },
  });
};

export const useCompleteBillRequest = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestId: string): Promise<BillRequest> => {
      const response = await api.patch(`/customer-orders/bill-requests/${requestId}/complete`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['billRequests'],
        refetchType: 'all'
      });
      toast.success(i18n.t('common:notifications.billRequestCompleted'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.requestCompleteFailed'));
    },
  });
};

// ========================================
// TABLE TRANSFER - STAFF HOOKS
// ========================================

export interface TransferTableOrdersDto {
  sourceTableId: string;
  targetTableId: string;
  allowMerge?: boolean;
}

export interface TransferTableResponse {
  message: string;
  transferredOrders: Order[];
  sourceTable: { id: string; number: string; newStatus: string };
  targetTable: { id: string; number: string; newStatus: string };
}

export const useTransferTableOrders = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: TransferTableOrdersDto): Promise<TransferTableResponse> => {
      const response = await api.post('/orders/transfer-table', data);
      return response.data;
    },
    onSuccess: (data) => {
      // Invalidate orders and tables queries
      queryClient.invalidateQueries({
        queryKey: ['orders'],
        refetchType: 'all'
      });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(i18n.t('pos:transfer.success', {
        sourceTable: data.sourceTable.number,
        targetTable: data.targetTable.number,
      }));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('pos:transfer.failed'));
    },
  });
};
