import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

let socket: Socket | null = null;
let notificationSocket: Socket | null = null;

export const initializeSocket = (): Socket => {
  if (socket && socket.connected) {
    return socket;
  }

  const token = useAuthStore.getState().accessToken;

  socket = io(`${SOCKET_URL}/kds`, {
    auth: {
      token,
    },
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    console.log('Socket connected:', socket?.id);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });

  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
  });

  return socket;
};

export const getSocket = (): Socket | null => {
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

// Notification Socket
export const initializeNotificationSocket = (onNotification?: (notification: any) => void): Socket => {
  if (notificationSocket && notificationSocket.connected) {
    return notificationSocket;
  }

  const token = useAuthStore.getState().accessToken;

  notificationSocket = io(`${SOCKET_URL}/notifications`, {
    auth: {
      token,
    },
    transports: ['websocket', 'polling'],
  });

  notificationSocket.on('connect', () => {
    console.log('Notification socket connected:', notificationSocket?.id);
  });

  notificationSocket.on('disconnect', () => {
    console.log('Notification socket disconnected');
  });

  notificationSocket.on('connect_error', (error) => {
    console.error('Notification socket connection error:', error);
  });

  // Listen for notifications
  if (onNotification) {
    notificationSocket.on('notification', onNotification);
  }

  return notificationSocket;
};

export const getNotificationSocket = (): Socket | null => {
  return notificationSocket;
};

export const disconnectNotificationSocket = () => {
  if (notificationSocket) {
    notificationSocket.disconnect();
    notificationSocket = null;
  }
};

export default {
  initializeSocket,
  getSocket,
  disconnectSocket,
  initializeNotificationSocket,
  getNotificationSocket,
  disconnectNotificationSocket,
};
