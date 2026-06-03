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

  useAuthStore.subscribe((state, prev) => {
    if (state.accessToken !== prev.accessToken && socket) {
      (socket.auth as any).token = state.accessToken ?? undefined;
      if (socket.connected) {
        socket.disconnect().connect();
      }
    }
  });

  // v3.0.0 — react to BranchPicker changes by emitting `switchBranch`
  // to the live socket. The backend moves the connection between
  // rooms without a reconnect; the SPA gets a clean ack/nack from
  // the server's allow-list check.
  useBranchScopeStore.subscribe((state, prev) => {
    if (state.branchId !== prev.branchId && socket?.connected && state.branchId) {
      socket.emit('switchBranch', { branchId: state.branchId });
    }
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

  useAuthStore.subscribe((state, prev) => {
    if (state.accessToken !== prev.accessToken && notificationSocket) {
      (notificationSocket.auth as any).token = state.accessToken ?? undefined;
      if (notificationSocket.connected) {
        notificationSocket.disconnect().connect();
      }
    }
  });

  // Branch switch over the notifications socket — same shape as the
  // KDS socket. The backend updates the tenant:${tenantId}:branch:${branchId}
  // room membership atomically.
  useBranchScopeStore.subscribe((state, prev) => {
    if (
      state.branchId !== prev.branchId &&
      notificationSocket?.connected &&
      state.branchId
    ) {
      notificationSocket.emit('switchBranch', { branchId: state.branchId });
    }
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
