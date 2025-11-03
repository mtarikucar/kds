import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../../store/authStore';

let socket: Socket | null = null;

export const usePosSocket = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user?.tenantId) return;

    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const WS_URL = API_URL.replace('/api', '').replace('http', 'ws');

    // Initialize socket connection if not already connected
    if (!socket) {
      socket = io(WS_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });

      socket.on('connect', () => {
        console.log('[POS Socket] Connected to WebSocket server');
        // Join POS room for this tenant
        socket?.emit('pos:join', { tenantId: user.tenantId });
      });

      socket.on('disconnect', () => {
        console.log('[POS Socket] Disconnected from WebSocket server');
      });
    }

    // Listen for new orders
    const handleNewOrder = (data: any) => {
      console.log('[POS Socket] New order received:', data);
      // Invalidate all order queries to refetch
      queryClient.invalidateQueries({ 
        queryKey: ['orders'],
        refetchType: 'all' 
      });
      // Also invalidate tables in case status changed
      queryClient.invalidateQueries({ queryKey: ['tables'] });
    };

    // Listen for order updates
    const handleOrderUpdate = (data: any) => {
      console.log('[POS Socket] Order updated:', data);
      // Invalidate all order queries to refetch
      queryClient.invalidateQueries({ 
        queryKey: ['orders'],
        refetchType: 'all' 
      });
      // Also invalidate tables in case status changed
      queryClient.invalidateQueries({ queryKey: ['tables'] });
    };

    // Listen for order status changes
    const handleOrderStatusChange = (data: any) => {
      console.log('[POS Socket] Order status changed:', data);
      // Invalidate all order queries to refetch
      queryClient.invalidateQueries({ 
        queryKey: ['orders'],
        refetchType: 'all' 
      });
      // Also invalidate tables in case status changed
      queryClient.invalidateQueries({ queryKey: ['tables'] });
    };

    socket.on('order:new', handleNewOrder);
    socket.on('order:updated', handleOrderUpdate);
    socket.on('order:status-change', handleOrderStatusChange);

    return () => {
      socket?.off('order:new', handleNewOrder);
      socket?.off('order:updated', handleOrderUpdate);
      socket?.off('order:status-change', handleOrderStatusChange);
    };
  }, [user?.tenantId, queryClient]);

  return {
    isConnected: socket?.connected ?? false,
  };
};
