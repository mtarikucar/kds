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

      // Pure Socket.IO Push: Directly inject order into React Query cache
      // No API calls, instant UI updates

      // 1. Add to pending approval cache if requiresApproval
      if (event.requiresApproval) {
        const pendingOrders = queryClient.getQueryData<any[]>(['orders', 'pending']) || [];
        queryClient.setQueryData(['orders', 'pending'], [event, ...pendingOrders]);
        console.log('[POS Socket] Added order to pending approval cache');
      }

      // 2. Add to table-specific cache if table present
      if (event.tableId) {
        const tableQueryKey = ['orders', { tableId: event.tableId }];
        const tableOrders = queryClient.getQueryData<any[]>(tableQueryKey) || [];

        // Only add if not PENDING_APPROVAL (those stay in separate panel)
        if (event.status !== 'PENDING_APPROVAL') {
          queryClient.setQueryData(tableQueryKey, [event, ...tableOrders]);
          console.log('[POS Socket] Added order to table cache:', event.tableId);
        }
      }

      // 3. Invalidate tables to update occupied status (lightweight operation)
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

      // Pure Socket.IO Push: Update order in all relevant caches

      // 1. If order was approved (transitioned from PENDING_APPROVAL to PENDING)
      // Remove from pending approval cache and add to table cache
      if (event.status !== 'PENDING_APPROVAL') {
        // Remove from pending approval cache
        const pendingOrders = queryClient.getQueryData<any[]>(['orders', 'pending']) || [];
        const updatedPending = pendingOrders.filter(order => order.id !== event.id);
        queryClient.setQueryData(['orders', 'pending'], updatedPending);
        console.log('[POS Socket] Removed order from pending approval cache');

        // Add/update in table-specific cache
        if (event.tableId) {
          const tableQueryKey = ['orders', { tableId: event.tableId }];
          const tableOrders = queryClient.getQueryData<any[]>(tableQueryKey) || [];

          const existingIndex = tableOrders.findIndex(order => order.id === event.id);
          if (existingIndex >= 0) {
            // Update existing order
            const updated = [...tableOrders];
            updated[existingIndex] = event;
            queryClient.setQueryData(tableQueryKey, updated);
            console.log('[POS Socket] Updated existing order in table cache');
          } else {
            // Add new order (e.g., approved order)
            queryClient.setQueryData(tableQueryKey, [event, ...tableOrders]);
            console.log('[POS Socket] Added order to table cache after approval');
          }
        }
      } else {
        // Still pending approval, just update in pending cache
        const pendingOrders = queryClient.getQueryData<any[]>(['orders', 'pending']) || [];
        const existingIndex = pendingOrders.findIndex(order => order.id === event.id);
        if (existingIndex >= 0) {
          const updated = [...pendingOrders];
          updated[existingIndex] = event;
          queryClient.setQueryData(['orders', 'pending'], updated);
          console.log('[POS Socket] Updated order in pending approval cache');
        }
      }

      // 2. Update in any other caches via predicate (for KDS, etc.)
      queryClient.setQueriesData(
        {
          predicate: (query) => {
            const queryKey = query.queryKey;
            // Update all order list queries (except pending which we handled above)
            return queryKey[0] === 'orders' && queryKey[1] !== 'pending';
          },
        },
        (oldData: any) => {
          if (!Array.isArray(oldData)) return oldData;
          const existingIndex = oldData.findIndex((order: any) => order.id === event.id);
          if (existingIndex >= 0) {
            const updated = [...oldData];
            updated[existingIndex] = event;
            return updated;
          }
          return oldData;
        }
      );

      // 3. Invalidate tables to update status (lightweight operation)
      queryClient.invalidateQueries({ queryKey: ['tables'] });
    };

    const handleOrderStatusChanged = (event: any) => {
      console.log('[POS Socket] Order status changed:', event);

      // Pure Socket.IO Push: Update order status in all caches
      // Note: This event only contains orderId and status, not full order
      // So we update the status field in existing cache entries

      queryClient.setQueriesData(
        {
          predicate: (query) => {
            const queryKey = query.queryKey;
            return queryKey[0] === 'orders';
          },
        },
        (oldData: any) => {
          if (!Array.isArray(oldData)) return oldData;
          const existingIndex = oldData.findIndex((order: any) => order.id === event.orderId);
          if (existingIndex >= 0) {
            const updated = [...oldData];
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: event.status,
              updatedAt: event.timestamp || new Date().toISOString(),
            };
            console.log('[POS Socket] Updated order status in cache:', event.orderId, event.status);
            return updated;
          }
          return oldData;
        }
      );

      // Invalidate tables to update status (lightweight operation)
      queryClient.invalidateQueries({ queryKey: ['tables'] });
    };

    const handleOrderItemStatusChanged = (event: any) => {
      console.log('[POS Socket] Order item status changed:', event);

      // Pure Socket.IO Push: Update order item status in all caches
      // Note: This event only contains orderItemId and status
      // We need to find and update the specific item within orders

      queryClient.setQueriesData(
        {
          predicate: (query) => {
            const queryKey = query.queryKey;
            return queryKey[0] === 'orders';
          },
        },
        (oldData: any) => {
          if (!Array.isArray(oldData)) return oldData;

          // Find the order containing this item and update it
          const updated = oldData.map((order: any) => {
            // Check both 'items' and 'orderItems' arrays for backwards compatibility
            const items = order.items || order.orderItems || [];
            const itemIndex = items.findIndex((item: any) => item.id === event.orderItemId);

            if (itemIndex >= 0) {
              const updatedItems = [...items];
              updatedItems[itemIndex] = {
                ...updatedItems[itemIndex],
                status: event.status,
                updatedAt: event.timestamp || new Date().toISOString(),
              };

              console.log('[POS Socket] Updated order item status in cache:', event.orderItemId, event.status);

              return {
                ...order,
                items: order.items ? updatedItems : order.items,
                orderItems: order.orderItems ? updatedItems : order.orderItems,
                updatedAt: event.timestamp || new Date().toISOString(),
              };
            }
            return order;
          });

          return updated;
        }
      );
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
