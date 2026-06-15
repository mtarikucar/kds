import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import { useBranchScopeStore } from '../../store/branchScopeStore';
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
  PayItemsDto,
  PayItemsResponse,
  PayableItemsSummary,
} from '../../types';

// Opt-in tuning for the orders list. Used by the Kitchen Display board so it
// can (a) keep the last-known orders on screen across refetches/errors and
// (b) engage a polling fallback when its realtime socket drops. Defaults keep
// every existing caller's behavior identical (no polling, no placeholder).
export interface UseOrdersOptions {
  /** ms between background refetches, or false to disable polling. */
  refetchInterval?: number | false;
  /** Retain the previous query result while a new fetch is in flight. */
  keepPreviousData?: boolean;
}

export const useOrders = (filters?: OrderFilters, options?: UseOrdersOptions) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['orders', filters, branchId],
    queryFn: async (): Promise<Order[]> => {
      const response = await api.get<Order[]>('/orders', { params: filters });
      return response.data;
    },
    refetchInterval: options?.refetchInterval ?? false,
    placeholderData: options?.keepPreviousData ? keepPreviousData : undefined,
  });
};

export const useOrder = (id: string) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['orders', id, branchId],
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
      // Generate a stable client-side idempotency key per submit. If the
      // network blips and the user (or React-Query retry) re-fires this
      // mutation, the backend's partial unique index on
      // payments(orderId, idempotencyKey) returns the original payment
      // instead of duplicating it. The client controls the key so the
      // dedupe extends to the wire layer, not just to the DB write.
      const body = {
        ...paymentData,
        idempotencyKey: paymentData.idempotencyKey ?? crypto.randomUUID(),
      };
      const response = await api.post(`/orders/${orderId}/payments`, body);
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
      // Batch-level key so a retried split-bill submit recovers the
      // exact prior payment set. Backend derives per-entry keys as
      // `${batchKey}:${index}` (or honors explicit per-entry keys).
      const bodyWithKey = {
        ...body,
        idempotencyKey: body.idempotencyKey ?? crypto.randomUUID(),
      };
      const response = await api.post(
        `/orders/${orderId}/payments/split`,
        bodyWithKey,
      );
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
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['groupBillSummary', groupId, branchId],
    queryFn: async (): Promise<GroupBillSummary> => {
      const response = await api.get(`/orders/group-bill-summary/${groupId}`);
      return response.data;
    },
    enabled: !!groupId,
  });
};

// ========================================
// PROGRESSIVE ("DUTCH-STYLE") PAYMENTS
// ========================================

export const usePayableItems = (orderId: string | null) => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['payableItems', orderId, branchId],
    queryFn: async (): Promise<PayableItemsSummary> => {
      const response = await api.get(`/orders/${orderId}/payments/payable-items`);
      return response.data;
    },
    enabled: !!orderId,
    // Real-time invalidation comes from usePosSocket on order:updated.
  });
};

export const usePayByItems = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      data: PayItemsDto & { orderId: string },
    ): Promise<PayItemsResponse> => {
      const { orderId, ...body } = data;
      // Client-side idempotency key so a network retry recovers the
      // same payment instead of double-charging. Mirrors useCreatePayment.
      const bodyWithKey = {
        ...body,
        idempotencyKey: body.idempotencyKey ?? crypto.randomUUID(),
      };
      const response = await api.post(
        `/orders/${orderId}/payments/items`,
        bodyWithKey,
      );
      return response.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['tables'] });
      queryClient.invalidateQueries({ queryKey: ['tableGroup'] });
      queryClient.invalidateQueries({ queryKey: ['groupBillSummary'] });
      queryClient.invalidateQueries({
        queryKey: ['payableItems', variables.orderId],
      });
      toast.success(i18n.t('pos:progressive.paymentRecorded'));
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.message || i18n.t('pos:progressive.paymentFailed'),
      );
    },
  });
};

// ========================================
// CUSTOMER ORDERS - STAFF HOOKS
// ========================================

export const usePendingOrders = () => {
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['orders', 'pending', branchId],
    queryFn: async (): Promise<Order[]> => {
      const response = await api.get<Order[]>('/orders', {
        params: { status: 'PENDING_APPROVAL' },
      });
      return response.data;
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
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['waiterRequests', branchId],
    queryFn: async (): Promise<WaiterRequest[]> => {
      const response = await api.get<WaiterRequest[]>('/customer-orders/waiter-requests/tenant/active');
      return response.data;
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
  const branchId = useBranchScopeStore((s) => s.branchId);
  return useQuery({
    queryKey: ['billRequests', branchId],
    queryFn: async (): Promise<BillRequest[]> => {
      const response = await api.get<BillRequest[]>('/customer-orders/bill-requests/tenant/active');
      return response.data;
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
