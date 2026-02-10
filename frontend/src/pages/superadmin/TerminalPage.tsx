import { useState, useRef, useCallback, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { Terminal as TerminalIcon, Wifi, WifiOff, Loader2 } from 'lucide-react';
import SshConnectionForm, {
  SshConnectionData,
} from '../../features/superadmin/components/SshConnectionForm';
import TerminalView from '../../features/superadmin/components/TerminalView';
import {
  initializeTerminalSocket,
  disconnectTerminalSocket,
} from '../../features/superadmin/lib/terminalSocket';

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export default function TerminalPage() {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const cleanup = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.off('terminal:connected');
      socketRef.current.off('terminal:data');
      socketRef.current.off('terminal:disconnected');
      socketRef.current.off('terminal:error');
      socketRef.current.off('connect_error');
    }
    disconnectTerminalSocket();
    socketRef.current = null;
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const handleConnect = useCallback(
    (formData: SshConnectionData) => {
      setConnectionStatus('connecting');
      setError(null);

      cleanup();

      const socket = initializeTerminalSocket();
      socketRef.current = socket;

      socket.on('terminal:connected', () => {
        setConnectionStatus('connected');
        setError(null);
      });

      socket.on('terminal:disconnected', (payload: { reason?: string }) => {
        setConnectionStatus('disconnected');
        if (payload.reason) {
          setError(payload.reason);
        }
      });

      socket.on('terminal:error', (payload: { message: string }) => {
        setConnectionStatus('error');
        setError(payload.message);
      });

      socket.on('connect_error', (err: Error) => {
        setConnectionStatus('error');
        setError(`Socket connection failed: ${err.message}`);
      });

      // Wait for socket connection, then emit terminal:connect
      if (socket.connected) {
        socket.emit('terminal:connect', formData);
      } else {
        socket.on('connect', () => {
          socket.emit('terminal:connect', formData);
        });
      }
    },
    [cleanup],
  );

  const handleDisconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.emit('terminal:disconnect');
    }
    cleanup();
    setConnectionStatus('disconnected');
  }, [cleanup]);

  const statusBadge = () => {
    switch (connectionStatus) {
      case 'connected':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Wifi className="w-3 h-3" />
            Connected
          </span>
        );
      case 'connecting':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <Loader2 className="w-3 h-3 animate-spin" />
            Connecting
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-red-50 text-red-700 border border-red-200">
            <WifiOff className="w-3 h-3" />
            Error
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200">
            <WifiOff className="w-3 h-3" />
            Disconnected
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
        <div className="flex items-center gap-3">
          <TerminalIcon className="w-5 h-5 text-zinc-700" />
          <h1 className="text-lg font-semibold text-zinc-900">SSH Terminal</h1>
          {statusBadge()}
        </div>

        {connectionStatus === 'connected' && (
          <button
            onClick={handleDisconnect}
            className="px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
          >
            Disconnect
          </button>
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-hidden ${connectionStatus !== 'connected' ? 'p-6' : ''}`}>
        {connectionStatus !== 'connected' ? (
          <div className="max-w-lg mx-auto">
            <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-semibold text-zinc-900 mb-4">
                SSH Connection
              </h2>

              {error && (
                <div className="mb-4 p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {error}
                </div>
              )}

              <SshConnectionForm
                onConnect={handleConnect}
                isConnecting={connectionStatus === 'connecting'}
              />
            </div>
          </div>
        ) : (
          socketRef.current && (
            <div className="h-full">
              <TerminalView
                socket={socketRef.current}
                isConnected={connectionStatus === 'connected'}
              />
            </div>
          )
        )}
      </div>
    </div>
  );
}
