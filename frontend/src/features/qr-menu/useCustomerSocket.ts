import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

let socket: Socket | null = null;

interface UseCustomerSocketProps {
  sessionId: string;
  onOrderCreated?: (data: any) => void;
  onOrderApproved?: (data: any) => void;
  onOrderStatusUpdated?: (data: any) => void;
  onLoyaltyEarned?: (data: any) => void;
}

export const useCustomerSocket = ({
  sessionId,
  onOrderCreated,
  onOrderApproved,
  onOrderStatusUpdated,
  onLoyaltyEarned,
}: UseCustomerSocketProps) => {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    // Initialize socket with session-based authentication
    socket = io(`${SOCKET_URL}/kds`, {
      auth: {
        sessionId, // Customer authentication via sessionId
      },
      query: {
        sessionId, // Also pass as query for compatibility
      },
      transports: ['websocket', 'polling'],
    });

    const handleConnect = () => {
      console.log('[Customer Socket] Connected:', socket?.id);
      setIsConnected(true);
    };

    const handleDisconnect = () => {
      console.log('[Customer Socket] Disconnected');
      setIsConnected(false);
    };

    const handleConnectError = (error: any) => {
      console.error('[Customer Socket] Connection error:', error);
      setIsConnected(false);
    };

    const handleOrderCreated = (data: any) => {
      console.log('[Customer Socket] Order created:', data);
      onOrderCreated?.(data);
    };

    const handleOrderApproved = (data: any) => {
      console.log('[Customer Socket] Order approved:', data);
      onOrderApproved?.(data);
    };

    const handleOrderStatusUpdated = (data: any) => {
      console.log('[Customer Socket] Order status updated:', data);
      onOrderStatusUpdated?.(data);
    };

    const handleLoyaltyEarned = (data: any) => {
      console.log('[Customer Socket] Loyalty points earned:', data);
      onLoyaltyEarned?.(data);
    };

    // Setup event listeners
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('customer:order-created', handleOrderCreated);
    socket.on('customer:order-approved', handleOrderApproved);
    socket.on('customer:order-status-updated', handleOrderStatusUpdated);
    socket.on('customer:loyalty-earned', handleLoyaltyEarned);

    // Cleanup on unmount
    return () => {
      socket?.off('connect', handleConnect);
      socket?.off('disconnect', handleDisconnect);
      socket?.off('connect_error', handleConnectError);
      socket?.off('customer:order-created', handleOrderCreated);
      socket?.off('customer:order-approved', handleOrderApproved);
      socket?.off('customer:order-status-updated', handleOrderStatusUpdated);
      socket?.off('customer:loyalty-earned', handleLoyaltyEarned);
      socket?.disconnect();
      socket = null;
    };
  }, [sessionId, onOrderCreated, onOrderApproved, onOrderStatusUpdated, onLoyaltyEarned]);

  return {
    isConnected,
    socket,
  };
};
