import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { initializeSocket, disconnectSocket } from '../../lib/socket';
import { OrderStatusChangedEvent } from '../../types';
import { toast } from 'sonner';
import i18n from '../../i18n/config';

// Single shared AudioContext — Chromium limits concurrent contexts per tab
// and throws on construction in suspended states after ~6. Reused across
// every notification click instead of allocating fresh on each order.
let sharedAudioContext: AudioContext | null = null;
const getAudioContext = (): AudioContext | null => {
  if (sharedAudioContext) return sharedAudioContext;
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    sharedAudioContext = new Ctor();
    return sharedAudioContext;
  } catch {
    return null;
  }
};

export const useKitchenSocket = () => {
  const [isConnected, setIsConnected] = useState(false);
  const queryClient = useQueryClient();

  const playNotificationSound = () => {
    try {
      const audioContext = getAudioContext();
      if (!audioContext) return;
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = 800;
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

    // Room membership is decided server-side from the JWT role on connect;
    // no inbound join/leave messages are needed.

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('order:new', handleNewOrder);
      socket.off('order:updated', handleOrderUpdated);
      socket.off('order:status-changed', handleOrderStatusChanged);
      disconnectSocket();
    };
  }, [queryClient]);

  return { isConnected };
};
