import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket, initializeSocket } from '../../lib/socket';

export const usePersonnelSocket = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Reuse existing KDS socket or initialize if not connected
    const socket = getSocket() || initializeSocket();
    if (!socket) return;

    const handleAttendanceUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'attendance'] });
    };

    const handleSwapRequestUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ['personnel', 'swap-requests'] });
      queryClient.invalidateQueries({ queryKey: ['personnel', 'schedule'] });
    };

    socket.on('personnel:attendance-update', handleAttendanceUpdate);
    socket.on('personnel:swap-request-update', handleSwapRequestUpdate);

    return () => {
      socket.off('personnel:attendance-update', handleAttendanceUpdate);
      socket.off('personnel:swap-request-update', handleSwapRequestUpdate);
      // Do NOT disconnect — other features share this socket
    };
  }, [queryClient]);
};
