import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { initializeSocket, disconnectSocket } from '../../lib/socket';
import { toast } from 'sonner';

export const usePosSocket = () => {
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

      oscillator.frequency.value = 880; // Higher pitch for POS notifications
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.4);
    } catch (error) {
      console.warn('Failed to play notification sound:', error);
    }
  };

  useEffect(() => {
    const socket = initializeSocket();

    const handleConnect = () => {
      console.log('POS socket connected');
      setIsConnected(true);
    };

    const handleDisconnect = () => {
      console.log('POS socket disconnected');
      setIsConnected(false);
    };

    const handleNewOrder = (event: any) => {
      console.log('[POS Socket] New order received:', event);

      // Invalidate all order queries including table-specific ones
      // Using predicate to ensure all variations are invalidated
      queryClient.invalidateQueries({
        predicate: (query) => {
          const queryKey = query.queryKey;
          return queryKey[0] === 'orders';
        },
      });

      // Also invalidate tables to update occupied status
      queryClient.invalidateQueries({ queryKey: ['tables'] });

      // Play notification sound
      playNotificationSound();

      // Show toast notification for customer orders requiring approval
      if (event.requiresApproval) {
        toast.warning(`New Customer Order: #${event.orderNumber}`, {
          description: event.table ? `Table ${event.table.number} - Awaiting approval` : 'Awaiting approval',
          duration: 8000,
          position: 'top-right',
        });
      }
    };

    const handleOrderUpdated = (event: any) => {
      console.log('[POS Socket] Order updated:', event);

      // Invalidate all order queries including table-specific ones
      // This is critical for showing approved QR orders in table views
      queryClient.invalidateQueries({
        predicate: (query) => {
          const queryKey = query.queryKey;
          return queryKey[0] === 'orders';
        },
      });

      // Also invalidate tables to update status
      queryClient.invalidateQueries({ queryKey: ['tables'] });
    };

    const handleOrderStatusChanged = (event: any) => {
      console.log('[POS Socket] Order status changed:', event);

      // Invalidate all order queries including table-specific ones
      queryClient.invalidateQueries({
        predicate: (query) => {
          const queryKey = query.queryKey;
          return queryKey[0] === 'orders';
        },
      });

      // Also invalidate tables to update status
      queryClient.invalidateQueries({ queryKey: ['tables'] });
    };

    const handleOrderItemStatusChanged = (event: any) => {
      console.log('[POS Socket] Order item status changed:', event);

      // Invalidate all order queries
      queryClient.invalidateQueries({
        predicate: (query) => {
          const queryKey = query.queryKey;
          return queryKey[0] === 'orders';
        },
      });
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('order:new', handleNewOrder);
    socket.on('order:updated', handleOrderUpdated);
    socket.on('order:status-changed', handleOrderStatusChanged);
    socket.on('order:item-status-changed', handleOrderItemStatusChanged);

    // Join POS room
    socket.emit('join-pos');

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('order:new', handleNewOrder);
      socket.off('order:updated', handleOrderUpdated);
      socket.off('order:status-changed', handleOrderStatusChanged);
      socket.off('order:item-status-changed', handleOrderItemStatusChanged);
      socket.emit('leave-pos');
      disconnectSocket();
    };
  }, [queryClient]);

  return { isConnected };
};
