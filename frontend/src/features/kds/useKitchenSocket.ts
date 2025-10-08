import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { initializeSocket, disconnectSocket } from '../../lib/socket';
import { OrderStatusChangedEvent, NewOrderEvent } from '../../types';
import { toast } from 'sonner';

export const useKitchenSocket = () => {
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = initializeSocket();

    const handleConnect = () => {
      console.log('Kitchen socket connected');
      setIsConnected(true);
    };

    const handleDisconnect = () => {
      console.log('Kitchen socket disconnected');
      setIsConnected(false);
    };

    const handleNewOrder = (event: NewOrderEvent) => {
      console.log('New order received:', event.order);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      toast.info(`New order: #${event.order.orderNumber}`);
    };

    const handleOrderStatusChanged = (event: OrderStatusChangedEvent) => {
      console.log('Order status changed:', event);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders', event.orderId] });
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('order:new', handleNewOrder);
    socket.on('order:status-changed', handleOrderStatusChanged);

    // Join kitchen room
    socket.emit('join-kitchen');

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('order:new', handleNewOrder);
      socket.off('order:status-changed', handleOrderStatusChanged);
      socket.emit('leave-kitchen');
      disconnectSocket();
    };
  }, [queryClient]);

  return { isConnected };
};
