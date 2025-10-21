import { useState } from 'react';
import { DeviceStatus, DeviceType } from '@/types/hardware';
import { DeviceStatusIndicator } from './DeviceStatusIndicator';
import { HardwareService } from '@/lib/tauri';
import Button from '@/components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreVertical, Printer, DollarSign, Radio, Barcode } from 'lucide-react';

interface HardwareDeviceCardProps {
  device: DeviceStatus;
  onEdit?: (deviceId: string) => void;
  onDelete?: (deviceId: string) => void;
  onTest?: (deviceId: string) => void;
}

export function HardwareDeviceCard({
  device,
  onEdit,
  onDelete,
  onTest,
}: HardwareDeviceCardProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const getDeviceIcon = () => {
    switch (device.device_type) {
      case DeviceType.THERMAL_PRINTER:
        return <Printer className="h-5 w-5" />;
      case DeviceType.CASH_DRAWER:
        return <DollarSign className="h-5 w-5" />;
      case DeviceType.RESTAURANT_PAGER:
        return <Radio className="h-5 w-5" />;
      case DeviceType.BARCODE_READER:
        return <Barcode className="h-5 w-5" />;
      default:
        return <Printer className="h-5 w-5" />;
    }
  };

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await HardwareService.connectDevice(device.id);
    } catch (error) {
      console.error('Failed to connect device:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setIsConnecting(true);
    try {
      await HardwareService.disconnectDevice(device.id);
    } catch (error) {
      console.error('Failed to disconnect device:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    try {
      await HardwareService.testDevice(device.id);
      onTest?.(device.id);
    } catch (error) {
      console.error('Failed to test device:', error);
    } finally {
      setIsTesting(false);
    }
  };

  const formatLastActivity = (lastActivity?: string) => {
    if (!lastActivity) return 'Never';
    const date = new Date(lastActivity);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            {getDeviceIcon()}
          </div>
          <div>
            <CardTitle className="text-lg">{device.name}</CardTitle>
            <CardDescription>{device.device_type.replace('_', ' ')}</CardDescription>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit?.(device.id)}>
              Edit Configuration
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleTest} disabled={isTesting}>
              {isTesting ? 'Testing...' : 'Test Device'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete?.(device.id)}
              className="text-red-600"
            >
              Delete Device
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>

      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Status:</span>
          <DeviceStatusIndicator
            connectionStatus={device.connection_status}
            health={device.health}
            showLabel
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Last Activity:</span>
          <span className="text-sm">{formatLastActivity(device.last_activity)}</span>
        </div>

        {device.error_message && (
          <div className="rounded-md bg-red-50 p-2">
            <p className="text-xs text-red-600">{device.error_message}</p>
          </div>
        )}
      </CardContent>

      <CardFooter className="gap-2">
        {device.connection_status === 'Connected' ? (
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleDisconnect}
            disabled={isConnecting}
          >
            {isConnecting ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        ) : (
          <Button
            variant="default"
            className="flex-1"
            onClick={handleConnect}
            disabled={isConnecting}
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
