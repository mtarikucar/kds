import { io, Socket } from 'socket.io-client';
import { useSuperAdminAuthStore } from '../../../store/superAdminAuthStore';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000';

let terminalSocket: Socket | null = null;

export const initializeTerminalSocket = (): Socket => {
  if (terminalSocket && terminalSocket.connected) {
    return terminalSocket;
  }

  const token = useSuperAdminAuthStore.getState().accessToken;

  terminalSocket = io(`${SOCKET_URL}/superadmin-terminal`, {
    auth: {
      token,
    },
    transports: ['websocket'],
  });

  return terminalSocket;
};

export const getTerminalSocket = (): Socket | null => {
  return terminalSocket;
};

export const disconnectTerminalSocket = (): void => {
  if (terminalSocket) {
    terminalSocket.disconnect();
    terminalSocket = null;
  }
};
