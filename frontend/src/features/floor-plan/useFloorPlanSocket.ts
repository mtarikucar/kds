import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { initializeSocket, disconnectSocket } from '../../lib/socket';

/**
 * Keeps a live floor map in sync. Re-fetches the plan when:
 *  - an admin republishes the layout elsewhere (`floor:layout-updated`), or
 *  - anything that changes a table's status / active-order count happens
 *    (new/updated orders, status changes, payments, transfers, merges).
 *
 * The plan query (GET /floor-plan) already carries each table's status +
 * activeOrderCount, so a refetch is enough to recolor the map. Mount this in
 * any component that renders a LIVE FloorMap.
 */
export function useFloorPlanSocket() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = initializeSocket();
    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: ['floorPlan'] });

    const events = [
      'floor:layout-updated',
      'order:new',
      'order:updated',
      'order:status-changed',
      'payment:success',
      'table:orders-transferred',
      'table:merged',
      'table:unmerged',
    ];
    events.forEach((e) => socket.on(e, invalidate));

    return () => {
      events.forEach((e) => socket.off(e, invalidate));
      disconnectSocket();
    };
  }, [queryClient]);
}
