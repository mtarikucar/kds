import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Printer, DollarSign, Radio, Barcode } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HardwareDeviceCard } from '@/components/hardware/HardwareDeviceCard';
import { DeviceConfigModal } from '@/components/hardware/DeviceConfigModal';
import { HardwareService, isTauri } from '@/lib/tauri';
import {
  useGetIntegrations,
  useCreateIntegration,
  useUpdateIntegration,
  useDeleteIntegration,
} from '@/features/settings/settingsApi';
import { DeviceType, DeviceStatus, HardwareEvent } from '@/types/hardware';
import { toast } from 'sonner';

/**
 * Tauri desktop hardware card (printers / cash drawers / pagers / scanners),
 * split out of IntegrationsSettingsPage so it can live in the branch hub's
 * Hardware tab (BranchDetailPage) instead — cihaz birleşimi, Task 6.
 *
 * Self-contained: owns its own integrations query/mutations (for the
 * backend-side row each physical device mirrors) and its own local
 * ~/.kds/hardware.json state via HardwareService. Only rendered when
 * `isTauri()` is true (the caller gates the tab on it too), but this
 * component also no-ops its own card when not — same defensive behavior
 * the original IntegrationsSettingsPage had (`{isTauri() && (...)}`).
 */
export default function HardwareDevicesSection() {
  const { t } = useTranslation('settings');
  const [deviceConfigModalOpen, setDeviceConfigModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<any>(null);
  const [hardwareDevices, setHardwareDevices] = useState<DeviceStatus[]>([]);
  const [hardwareInitialized, setHardwareInitialized] = useState(false);

  // API hooks
  const { data: integrations, refetch } = useGetIntegrations();
  const createIntegration = useCreateIntegration();
  const updateIntegration = useUpdateIntegration();
  const deleteIntegration = useDeleteIntegration();

  // Initialize hardware manager
  useEffect(() => {
    if (isTauri() && !hardwareInitialized) {
      const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      HardwareService.initialize(backendUrl)
        .then(() => {
          setHardwareInitialized(true);
          loadHardwareDevices();
          toast.success(t('hardware.initialized'));
        })
        .catch((error) => {
          console.error('Failed to initialize hardware:', error);
          toast.error(t('hardware.initFailed'));
        });
    }
  }, [hardwareInitialized]);

  // Listen for hardware events
  useEffect(() => {
    if (!isTauri()) return;

    const setupEventListener = async () => {
      const unlisten = await HardwareService.listenToHardwareEvents(
        (event: HardwareEvent) => {
          handleHardwareEvent(event);
        }
      );
      return unlisten;
    };

    let unlistenFn: (() => void) | undefined;
    setupEventListener().then((fn) => {
      unlistenFn = fn;
    });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const loadHardwareDevices = async () => {
    if (!isTauri()) return;
    try {
      const devices = await HardwareService.listDevices();
      setHardwareDevices(devices);
    } catch (error) {
      console.error('Failed to load hardware devices:', error);
    }
  };

  const handleHardwareEvent = (event: HardwareEvent) => {
    switch (event.type) {
      case 'DeviceConnected':
  toast.success(t('hardware.deviceConnected', { name: event.data.device_name }));
        loadHardwareDevices();
        break;
      case 'DeviceDisconnected':
  toast.info(t('hardware.deviceDisconnected', { name: event.data.device_name }));
        loadHardwareDevices();
        break;
      case 'BarcodeScanned':
  toast.info(t('hardware.barcodeScanned', { code: event.data.barcode_data }));
        break;
      case 'PaperOut':
  toast.error(t('hardware.paperOut', { name: event.data.device_id }));
        break;
      case 'PaperLow':
  toast.warning(t('hardware.paperLow', { name: event.data.device_id }));
        break;
      case 'DeviceError':
  toast.error(t('hardware.deviceError', { name: event.data.device_id, error: event.data.error }));
        loadHardwareDevices();
        break;
      default:
        console.log('Hardware event:', event);
    }
  };

  const handleSaveDevice = async (config: any) => {
    try {
      // Backend integrations table holds tenant-level abstract metadata
      // ("we use a Star Micronics printer of model X"). Each terminal's
      // physical pairing lives in ~/.kds/hardware.json on that machine,
      // managed via HardwareService.addDevice. We update both: the
      // tenant row + the local row. The local row is what the auto-
      // print path reads when firing on payment-success / order:new.
      let savedRow;
      if (editingDevice) {
        savedRow = await updateIntegration.mutateAsync({
          id: editingDevice.id,
          data: config,
        });
        toast.success(t('hardware.deviceUpdated'));
      } else {
        savedRow = await createIntegration.mutateAsync(config);
        toast.success(t('hardware.deviceAdded'));
      }

      // Mirror to ~/.kds/hardware.json on the current terminal so the
      // POS print path can find this device. Failure here is logged
      // but doesn't fail the save — the backend row still exists,
      // and the user can retry by re-saving.
      if (isTauri() && savedRow) {
        try {
          const cfg = config.configuration || {};
          await HardwareService.addDevice({
            id: savedRow.id ?? editingDevice?.id,
            name: config.provider,
            device_type: config.integrationType,
            enabled: !!config.isEnabled,
            auto_connect: !!cfg.auto_connect,
            connection: {
              connection_type: cfg.connection_type,
              config: cfg.connection_config,
            },
          });
        } catch (localErr) {
          console.error('Failed to mirror device to local hardware config:', localErr);
          toast.warning(
            t('hardware.localMirrorFailed', {
              defaultValue: 'Saved on backend but local pairing failed — check ~/.kds/hardware.json',
            }),
          );
        }
      }

      setDeviceConfigModalOpen(false);
      setEditingDevice(null);
      refetch();

      // Wait a bit for backend to process, then reload hardware
      setTimeout(() => {
        loadHardwareDevices();
      }, 1000);
    } catch (error) {
      toast.error(t('hardware.deviceSaveFailed'));
    }
  };

  const handleEditDevice = (deviceId: string) => {
    const device = integrations?.find((int) => int.id === deviceId);
    if (device) {
      setEditingDevice(device);
      setDeviceConfigModalOpen(true);
    }
  };

  const handleTestDevice = async (deviceId: string) => {
    try {
      await HardwareService.testDevice(deviceId);
  toast.success(t('hardware.testSuccess'));
    } catch (error) {
  toast.error(t('hardware.testFailed'));
    }
  };

  // Device branch of IntegrationsSettingsPage's old shared delete handler —
  // this one also unregisters the local ~/.kds/hardware.json pairing (the
  // plain-integrations delete in IntegrationsSettingsPage doesn't need to).
  const handleDeleteIntegration = async (id: string) => {
  if (!confirm(t('integrations.confirmDelete'))) return;

    try {
      await deleteIntegration.mutateAsync(id);
      toast.success(t('integrations.deleteSuccess'));

      // Remove from local hardware config too. Same fail-soft as save:
      // a backend deletion that fails to remove the local row leaves
      // the user with a "ghost" pairing, but it's recoverable by
      // editing ~/.kds/hardware.json or re-adding/removing.
      if (isTauri()) {
        try {
          await HardwareService.disconnectDevice(id).catch(() => undefined);
          await HardwareService.removeDevice(id);
        } catch (localErr) {
          console.error('Failed to remove device from local hardware config:', localErr);
        }
      }

      refetch();
      loadHardwareDevices();
    } catch (error) {
      toast.error(t('integrations.deleteFailed'));
    }
  };

  const filterDevicesByType = (type: DeviceType) => {
    return hardwareDevices.filter((device) => device.device_type === type);
  };

  if (!isTauri()) return null;

  return (
    <>
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t('hardwareDevices')}</CardTitle>
            <Button
              variant="primary"
              onClick={() => {
                setEditingDevice(null);
                setDeviceConfigModalOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('common:buttons.add')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="printers" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="printers">
                <Printer className="h-4 w-4 mr-2" />
                {t('printers')}
              </TabsTrigger>
              <TabsTrigger value="cash-drawers">
                <DollarSign className="h-4 w-4 mr-2" />
                {t('cashDrawers')}
              </TabsTrigger>
              <TabsTrigger value="pagers">
                <Radio className="h-4 w-4 mr-2" />
                {t('pagers')}
              </TabsTrigger>
              <TabsTrigger value="scanners">
                <Barcode className="h-4 w-4 mr-2" />
                {t('scanners')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="printers" className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filterDevicesByType(DeviceType.THERMAL_PRINTER).length > 0 ? (
                  filterDevicesByType(DeviceType.THERMAL_PRINTER).map((device) => (
                    <HardwareDeviceCard
                      key={device.id}
                      device={device}
                      onEdit={handleEditDevice}
                      onDelete={handleDeleteIntegration}
                      onTest={handleTestDevice}
                    />
                  ))
                ) : (
                  <div className="col-span-full text-center py-8 text-slate-500">
                    {t('noPrintersConfigured')}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="cash-drawers" className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filterDevicesByType(DeviceType.CASH_DRAWER).length > 0 ? (
                  filterDevicesByType(DeviceType.CASH_DRAWER).map((device) => (
                    <HardwareDeviceCard
                      key={device.id}
                      device={device}
                      onEdit={handleEditDevice}
                      onDelete={handleDeleteIntegration}
                      onTest={handleTestDevice}
                    />
                  ))
                ) : (
                  <div className="col-span-full text-center py-8 text-slate-500">
                    {t('noCashDrawersConfigured')}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="pagers" className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filterDevicesByType(DeviceType.RESTAURANT_PAGER).length > 0 ? (
                  filterDevicesByType(DeviceType.RESTAURANT_PAGER).map((device) => (
                    <HardwareDeviceCard
                      key={device.id}
                      device={device}
                      onEdit={handleEditDevice}
                      onDelete={handleDeleteIntegration}
                      onTest={handleTestDevice}
                    />
                  ))
                ) : (
                  <div className="col-span-full text-center py-8 text-slate-500">
                    {t('noPagersConfigured')}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="scanners" className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filterDevicesByType(DeviceType.BARCODE_READER).length > 0 ? (
                  filterDevicesByType(DeviceType.BARCODE_READER).map((device) => (
                    <HardwareDeviceCard
                      key={device.id}
                      device={device}
                      onEdit={handleEditDevice}
                      onDelete={handleDeleteIntegration}
                      onTest={handleTestDevice}
                    />
                  ))
                ) : (
                  <div className="col-span-full text-center py-8 text-slate-500">
                    {t('noBarcodeScanners')}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Device Configuration Modal */}
      <DeviceConfigModal
        open={deviceConfigModalOpen}
        onClose={() => {
          setDeviceConfigModalOpen(false);
          setEditingDevice(null);
        }}
        onSave={handleSaveDevice}
        initialData={editingDevice?.configuration}
        mode={editingDevice ? 'edit' : 'create'}
      />
    </>
  );
}
