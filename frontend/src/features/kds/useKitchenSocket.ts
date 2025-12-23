import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { initializeSocket, disconnectSocket } from '../../lib/socket';
import { OrderStatusChangedEvent, NewOrderEvent } from '../../types';
import { toast } from 'sonner';
import i18n from '../../i18n/config';

export const useKitchenSocket = () => {
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();

  // Create notification sound using Web Audio API
  const playNotificationSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800; // Frequency in Hz
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (error) {
      console.warn('Failed to play notification sound:', error);
    }
  };

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

    const handleNewOrder = (event: any) => {
      console.log('[KDS Socket] New order received:', event);
      queryClient.invalidateQueries({ queryKey: ['orders'] });

      // Play notification sound
      playNotificationSound();

      // Show toast notification
      toast.success(i18n.t('kitchen:kitchen.newOrderNotification', { orderNumber: event.orderNumber }), {
        duration: 5000,
        position: 'top-center',
      });
    };

    const handleOrderUpdated = (event: any) => {
      console.log('Order updated:', event);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders', event.orderId] });

      // Play notification sound for updated orders too
      playNotificationSound();

      // Show toast notification
      toast.info(i18n.t('kitchen:kitchen.orderUpdatedNotification', { orderNumber: event.orderNumber }), {
        duration: 5000,
        position: 'top-center',
      });
    };

    const handleOrderStatusChanged = (event: OrderStatusChangedEvent) => {
      console.log('Order status changed:', event);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['orders', event.orderId] });
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('order:new', handleNewOrder);
    socket.on('order:updated', handleOrderUpdated);
    socket.on('order:status-changed', handleOrderStatusChanged);

    // Join kitchen room
    socket.emit('join-kitchen');

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('order:new', handleNewOrder);
      socket.off('order:updated', handleOrderUpdated);
      socket.off('order:status-changed', handleOrderStatusChanged);
      socket.emit('leave-kitchen');
      disconnectSocket();
    };
  }, [queryClient]);

  return { isConnected };
};
