import { ConnectionStatus, HealthStatus } from '@/types/hardware';

interface DeviceStatusIndicatorProps {
  connectionStatus: ConnectionStatus;
  health: HealthStatus;
  showLabel?: boolean;
}

export function DeviceStatusIndicator({
  connectionStatus,
  health,
  showLabel = false,
}: DeviceStatusIndicatorProps) {
  const getStatusColor = () => {
    if (connectionStatus === ConnectionStatus.DISCONNECTED) {
      return 'bg-slate-400';
    }
    if (connectionStatus === ConnectionStatus.CONNECTING) {
      return 'bg-yellow-400 animate-pulse';
    }
    if (connectionStatus === ConnectionStatus.ERROR) {
      return 'bg-red-500';
    }

    // Connected - check health
    switch (health) {
      case HealthStatus.HEALTHY:
        return 'bg-green-500';
      case HealthStatus.WARNING:
        return 'bg-yellow-500';
      case HealthStatus.ERROR:
        return 'bg-red-500';
      default:
        return 'bg-slate-400';
    }
  };

  const getStatusLabel = () => {
    if (connectionStatus === ConnectionStatus.DISCONNECTED) {
      return 'Disconnected';
    }
    if (connectionStatus === ConnectionStatus.CONNECTING) {
      return 'Connecting...';
    }
    if (connectionStatus === ConnectionStatus.ERROR) {
      return 'Error';
    }

    // Connected - check health
    switch (health) {
      case HealthStatus.HEALTHY:
        return 'Connected';
      case HealthStatus.WARNING:
        return 'Warning';
      case HealthStatus.ERROR:
        return 'Error';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className={`h-3 w-3 rounded-full ${getStatusColor()}`} />
      {showLabel && (
        <span className="text-sm text-slate-600">{getStatusLabel()}</span>
      )}
    </div>
  );
}
