import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { useBranchScopeStore } from '../store/branchScopeStore';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

let socket: Socket | null = null;
let notificationSocket: Socket | null = null;

/**
 * Refcount so simultaneous POS + KDS + Notifications mounts share
 * one socket and nobody yanks it out from under a sibling hook. The last
 * unmount calls disconnectSocket(); everything before that just decrements.
 */
let socketRefCount = 0;
let notificationRefCount = 0;

// deep-review FM1/FM4 — register the store subscriptions ONCE at module load
// instead of inside initializeSocket/initializeNotificationSocket. Previously
// every mount/unmount or logout→login cycle re-created the sockets and added a
// fresh, never-released pair of Zustand subscriptions. Over a long-lived
// kiosk/KDS session that leaked memory and meant a single accessToken rotation
// fired N stale reconnects and a branch switch emitted N duplicate
// `switchBranch` events. The callbacks already null-check the global sockets
// and no-op when null, so a single module-lifetime subscription pair is
// sufficient — count stays at exactly one pair regardless of socket churn.
useAuthStore.subscribe((state, prev) => {
  if (state.accessToken === prev.accessToken) return;
  if (socket) {
    (socket.auth as any).token = state.accessToken ?? undefined;
    if (socket.connected) {
      socket.disconnect().connect();
    }
  }
  if (notificationSocket) {
    (notificationSocket.auth as any).token = state.accessToken ?? undefined;
    if (notificationSocket.connected) {
      notificationSocket.disconnect().connect();
    }
  }
});

// v3.0.0 — react to BranchPicker changes by emitting `switchBranch` to the live
// socket(s). The backend moves the connection between rooms without a reconnect
// and acks/nacks via its allow-list check.
useBranchScopeStore.subscribe((state, prev) => {
  if (state.branchId === prev.branchId || !state.branchId) return;
  if (socket?.connected) {
    socket.emit('switchBranch', { branchId: state.branchId });
  }
  if (notificationSocket?.connected) {
    notificationSocket.emit('switchBranch', { branchId: state.branchId });
  }
});

export const initializeSocket = (): Socket => {
  socketRefCount += 1;

  if (socket && socket.connected) {
    return socket;
  }
  if (socket) {
    // Instance exists but disconnected (e.g. after logout rotation). Reuse.
    socket.connect();
    return socket;
  }

  const token = useAuthStore.getState().accessToken;
  const branchId = useBranchScopeStore.getState().branchId;

  // v3.0.0 — the staff socket must carry branchId on connect so the
  // backend KDS gateway can scope its room membership to a single
  // (tenantId, branchId) tuple. Pre-v3 the room layout was
  // tenant-only and a WAITER pinned to branch A still saw branch B's
  // order:new events.
  socket = io(`${SOCKET_URL}/kds`, {
    auth: { token, branchId },
    transports: ['websocket', 'polling'],
  });

  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error.message);
  });

  return socket;
};

export const getSocket = (): Socket | null => socket;

export const disconnectSocket = () => {
  socketRefCount = Math.max(0, socketRefCount - 1);
  if (socketRefCount > 0) return; // still in use by another hook
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

/** Force-disconnect even with outstanding refs (used on logout). */
export const forceDisconnectSocket = () => {
  socketRefCount = 0;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const initializeNotificationSocket = (
  onNotification?: (notification: any) => void,
): Socket => {
  notificationRefCount += 1;

  if (notificationSocket && notificationSocket.connected) {
    return notificationSocket;
  }
  if (notificationSocket) {
    notificationSocket.connect();
    return notificationSocket;
  }

  const token = useAuthStore.getState().accessToken;
  const branchId = useBranchScopeStore.getState().branchId;

  notificationSocket = io(`${SOCKET_URL}/notifications`, {
    auth: { token, branchId },
    transports: ['websocket', 'polling'],
  });

  notificationSocket.on('connect_error', (error) => {
    console.error('Notification socket connection error:', error.message);
  });

  if (onNotification) {
    notificationSocket.on('notification', onNotification);
  }

  return notificationSocket;
};

export const getNotificationSocket = (): Socket | null => notificationSocket;

export const disconnectNotificationSocket = () => {
  notificationRefCount = Math.max(0, notificationRefCount - 1);
  if (notificationRefCount > 0) return;
  if (notificationSocket) {
    notificationSocket.disconnect();
    notificationSocket = null;
  }
};

export const forceDisconnectNotificationSocket = () => {
  notificationRefCount = 0;
  if (notificationSocket) {
    notificationSocket.disconnect();
    notificationSocket = null;
  }
};

export default {
  initializeSocket,
  getSocket,
  disconnectSocket,
  forceDisconnectSocket,
  initializeNotificationSocket,
  getNotificationSocket,
  disconnectNotificationSocket,
  forceDisconnectNotificationSocket,
};
