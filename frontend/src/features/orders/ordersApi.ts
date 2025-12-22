import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import {
  Order,
  CreateOrderDto,
  UpdateOrderDto,
  CreatePaymentDto,
  Payment,
  OrderFilters,
  WaiterRequest,
  BillRequest,
} from '../../types';

export const useOrders = (filters?: OrderFilters) => {
  return useQuery({
    queryKey: ['orders', filters],
    queryFn: async (): Promise<Order[]> => {
      console.log('[useOrders] Fetching orders with filters:', filters);
      const response = await api.get('/orders', { params: filters });
      console.log('[useOrders] Response:', response.data);
      return response.data;
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
      data: UpdateOrderDto;
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
// CUSTOMER ORDERS - STAFF HOOKS
// ========================================

export const usePendingOrders = () => {
  return useQuery({
    queryKey: ['orders', 'pending'],
    queryFn: async (): Promise<Order[]> => {
      const response = await api.get('/orders', {
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
      toast.success('Order approved successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to approve order');
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
      return response.data;
    },
    refetchInterval: 10000, // Poll every 10 seconds
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
      toast.success('Waiter request acknowledged');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to acknowledge request');
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
      toast.success('Waiter request completed');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to complete request');
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
      return response.data;
    },
    refetchInterval: 10000, // Poll every 10 seconds
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
      toast.success('Bill request acknowledged');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to acknowledge request');
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
      toast.success('Bill request completed');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to complete request');
    },
  });
};
