import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DeviceStatus, DeviceType } from '@/types/hardware';
import { DeviceStatusIndicator } from './DeviceStatusIndicator';
import { HardwareService } from '@/lib/tauri';
import { useUiStore } from '@/store/uiStore';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MoreVertical,
  Printer,
  DollarSign,
  Radio,
  Barcode,
  Star,
  ChefHat,
} from 'lucide-react';

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
  const { t } = useTranslation(['settings', 'common']);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  // Per-machine default-printer prefs from uiStore. THERMAL_PRINTER
  // devices can be marked as the default receipt or kitchen printer —
  // those defaults are what POSPage and usePosSocket read when firing
  // auto-print on payment-success / order:new respectively.
  const defaultReceiptPrinterId = useUiStore((s) => s.defaultReceiptPrinterId);
  const defaultKitchenPrinterId = useUiStore((s) => s.defaultKitchenPrinterId);
  const setDefaultReceiptPrinterId = useUiStore((s) => s.setDefaultReceiptPrinterId);
  const setDefaultKitchenPrinterId = useUiStore((s) => s.setDefaultKitchenPrinterId);

  const isPrinter = device.device_type === DeviceType.THERMAL_PRINTER;
  const isDefaultReceipt = defaultReceiptPrinterId === device.id;
  const isDefaultKitchen = defaultKitchenPrinterId === device.id;

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

  const handleSetDefaultReceipt = () => {
    const next = isDefaultReceipt ? null : device.id;
    setDefaultReceiptPrinterId(next);
    toast.success(
      next
        ? t('settings.hardware.defaultReceiptSet', {
            name: device.name,
            defaultValue: '{{name}} is now the default receipt printer',
          })
        : t('settings.hardware.defaultReceiptCleared', {
            defaultValue: 'Default receipt printer cleared',
          }),
    );
  };

  const handleSetDefaultKitchen = () => {
    const next = isDefaultKitchen ? null : device.id;
    setDefaultKitchenPrinterId(next);
    toast.success(
      next
        ? t('settings.hardware.defaultKitchenSet', {
            name: device.name,
            defaultValue: '{{name}} is now the default kitchen printer',
          })
        : t('settings.hardware.defaultKitchenCleared', {
            defaultValue: 'Default kitchen printer cleared',
          }),
    );
  };

  const formatLastActivity = (lastActivity?: string) => {
    if (!lastActivity) return t('settings.hardware.lastActivity.never');
    const date = new Date(lastActivity);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return t('settings.hardware.lastActivity.justNow');
    if (diffMins < 60) return t('settings.hardware.lastActivity.minutesAgo', { count: diffMins });
    if (diffMins < 1440) return t('settings.hardware.lastActivity.hoursAgo', { count: Math.floor(diffMins / 60) });
    return t('settings.hardware.lastActivity.daysAgo', { count: Math.floor(diffMins / 1440) });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            {getDeviceIcon()}
          </div>
          <div className="flex flex-col gap-1">
            <CardTitle className="text-lg flex items-center gap-2">
              {device.name}
              {isDefaultReceipt && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                  title={t('settings.hardware.defaultReceiptBadge', { defaultValue: 'Default receipt printer' })}
                >
                  <Star className="h-3 w-3 fill-current" />
                  {t('settings.hardware.defaultReceiptShort', { defaultValue: 'Receipt' })}
                </span>
              )}
              {isDefaultKitchen && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800"
                  title={t('settings.hardware.defaultKitchenBadge', { defaultValue: 'Default kitchen printer' })}
                >
                  <ChefHat className="h-3 w-3" />
                  {t('settings.hardware.defaultKitchenShort', { defaultValue: 'Kitchen' })}
                </span>
              )}
            </CardTitle>
            <CardDescription>{t(`settings.integrationTypes.${device.device_type}`)}</CardDescription>
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
              {t('settings.hardware.editConfiguration')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleTest} disabled={isTesting}>
              {isTesting ? t('settings.hardware.testing') : t('settings.hardware.testDevice')}
            </DropdownMenuItem>
            {isPrinter && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSetDefaultReceipt}>
                  <Star className="h-4 w-4 mr-2" />
                  {isDefaultReceipt
                    ? t('settings.hardware.unsetDefaultReceipt', { defaultValue: 'Unset as default receipt printer' })
                    : t('settings.hardware.setDefaultReceipt', { defaultValue: 'Set as default receipt printer' })}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSetDefaultKitchen}>
                  <ChefHat className="h-4 w-4 mr-2" />
                  {isDefaultKitchen
                    ? t('settings.hardware.unsetDefaultKitchen', { defaultValue: 'Unset as default kitchen printer' })
                    : t('settings.hardware.setDefaultKitchen', { defaultValue: 'Set as default kitchen printer' })}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete?.(device.id)}
              className="text-red-600"
            >
              {t('settings.hardware.deleteDevice')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>

      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('settings.hardware.statusLabel')}</span>
          <DeviceStatusIndicator
            connectionStatus={device.connection_status}
            health={device.health}
            showLabel
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('settings.hardware.lastActivity.label')}</span>
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
            {isConnecting ? t('settings.hardware.disconnecting') : t('common:buttons.disconnect')}
          </Button>
        ) : (
          <Button
            variant="default"
            className="flex-1"
            onClick={handleConnect}
            disabled={isConnecting}
          >
            {isConnecting ? t('settings.hardware.connecting') : t('common:buttons.connect')}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
