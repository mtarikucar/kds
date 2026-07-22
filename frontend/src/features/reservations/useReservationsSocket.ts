import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { initializeSocket, disconnectSocket } from '../../lib/socket';

/**
 * Keeps the admin reservations surface live. Re-fetches when the backend
 * emits `reservation:new` (any source) or `reservation:updated` (every
 * lifecycle transition / edit) on the tenant/branch socket.
 *
 * Invalidating the ['reservations'] prefix covers the list query AND the
 * pending-count badge (which is keyed ['reservations','pending-count', …]);
 * ['reservationStats'] is a sibling key so it's invalidated explicitly.
 * Subscribe/tear-down mirrors useFloorPlanSocket so the shared socket
 * refcount stays balanced.
 */
export function useReservationsSocket() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = initializeSocket();
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      queryClient.invalidateQueries({ queryKey: ['reservationStats'] });
    };

    const events = ['reservation:new', 'reservation:updated'];
    events.forEach((e) => socket.on(e, invalidate));

    return () => {
      events.forEach((e) => socket.off(e, invalidate));
      disconnectSocket();
    };
  }, [queryClient]);
}
