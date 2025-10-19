import { useState, useEffect } from 'react';
import { Plug, Plus, Trash2, Power, PowerOff, Printer, DollarSign, Radio, Barcode } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HardwareDeviceCard } from '@/components/hardware/HardwareDeviceCard';
import { DeviceConfigModal } from '@/components/hardware/DeviceConfigModal';
import { HardwareService, isTauri } from '@/lib/tauri';
import {
  useGetIntegrations,
  useCreateIntegration,
  useUpdateIntegration,
  useDeleteIntegration,
  useToggleIntegration,
} from '@/features/settings/settingsApi';
import { DeviceType, DeviceStatus, HardwareEvent } from '@/types/hardware';
import { toast } from 'sonner';

const IntegrationsSettingsPage = () => {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [deviceConfigModalOpen, setDeviceConfigModalOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<any>(null);
  const [hardwareDevices, setHardwareDevices] = useState<DeviceStatus[]>([]);
  const [hardwareInitialized, setHardwareInitialized] = useState(false);

  // API hooks
  const { data: integrations, isLoading, refetch } = useGetIntegrations();
  const createIntegration = useCreateIntegration();
  const updateIntegration = useUpdateIntegration();
  const deleteIntegration = useDeleteIntegration();
  const toggleIntegration = useToggleIntegration();

  // Initialize hardware manager
  useEffect(() => {
    if (isTauri() && !hardwareInitialized) {
      const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      HardwareService.initialize(backendUrl)
        .then(() => {
          setHardwareInitialized(true);
          loadHardwareDevices();
          toast.success('Hardware manager initialized');
        })
        .catch((error) => {
          console.error('Failed to initialize hardware:', error);
          toast.error('Failed to initialize hardware manager');
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
        toast.success(`Device ${event.data.device_name} connected`);
        loadHardwareDevices();
        break;
      case 'DeviceDisconnected':
        toast.info(`Device ${event.data.device_name} disconnected`);
        loadHardwareDevices();
        break;
      case 'BarcodeScanned':
        toast.info(`Barcode scanned: ${event.data.barcode_data}`);
        break;
      case 'PaperOut':
        toast.error('Printer paper is out!');
        break;
      case 'PaperLow':
        toast.warning('Printer paper is low');
        break;
      case 'DeviceError':
        toast.error(`Device error: ${event.data.error}`);
        loadHardwareDevices();
        break;
      default:
        console.log('Hardware event:', event);
    }
  };

  const getIntegrationTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      PAYMENT_GATEWAY: 'Payment Gateway',
      POS_HARDWARE: 'POS Hardware',
      THIRD_PARTY_API: 'Third Party API',
      DELIVERY_APP: 'Delivery App',
      ACCOUNTING: 'Accounting',
      CRM: 'CRM',
      INVENTORY: 'Inventory',
      THERMAL_PRINTER: 'Thermal Printer',
      CASH_DRAWER: 'Cash Drawer',
      RESTAURANT_PAGER: 'Restaurant Pager',
      BARCODE_READER: 'Barcode Reader',
      CUSTOMER_DISPLAY: 'Customer Display',
      KITCHEN_DISPLAY: 'Kitchen Display',
      SCALE_DEVICE: 'Scale Device',
    };
    return types[type] || type;
  };

  const handleToggleIntegration = async (id: string, currentStatus: boolean) => {
    try {
      await toggleIntegration.mutateAsync({ id, isEnabled: !currentStatus });
      toast.success(
        `Integration ${!currentStatus ? 'enabled' : 'disabled'} successfully`
      );
      refetch();
      loadHardwareDevices(); // Reload hardware devices if it's a hardware integration
    } catch (error) {
      toast.error('Failed to toggle integration');
    }
  };

  const handleDeleteIntegration = async (id: string) => {
    if (!confirm('Are you sure you want to delete this integration?')) return;

    try {
      await deleteIntegration.mutateAsync(id);
      toast.success('Integration deleted successfully');
      refetch();
      loadHardwareDevices();
    } catch (error) {
      toast.error('Failed to delete integration');
    }
  };

  const handleSaveDevice = async (config: any) => {
    try {
      if (editingDevice) {
        await updateIntegration.mutateAsync({
          id: editingDevice.id,
          data: config,
        });
        toast.success('Device updated successfully');
      } else {
        await createIntegration.mutateAsync(config);
        toast.success('Device added successfully');
      }
      setDeviceConfigModalOpen(false);
      setEditingDevice(null);
      refetch();

      // Wait a bit for backend to process, then reload hardware
      setTimeout(() => {
        loadHardwareDevices();
      }, 1000);
    } catch (error) {
      toast.error('Failed to save device configuration');
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
      toast.success('Device test completed successfully');
    } catch (error) {
      toast.error('Device test failed');
    }
  };

  const filterDevicesByType = (type: DeviceType) => {
    return hardwareDevices.filter((device) => device.device_type === type);
  };

  const regularIntegrations = integrations?.filter(
    (int) =>
      !int.integrationType.includes('PRINTER') &&
      !int.integrationType.includes('DRAWER') &&
      !int.integrationType.includes('PAGER') &&
      !int.integrationType.includes('BARCODE') &&
      !int.integrationType.includes('DISPLAY') &&
      !int.integrationType.includes('SCALE')
  );

  return (
    <div className="h-full p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
            <p className="text-gray-600 mt-1">
              Connect third-party services and manage hardware integrations
            </p>
          </div>
        </div>
      </div>

      {/* Hardware Devices Section */}
      {isTauri() && (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Hardware Devices</CardTitle>
              <Button
                variant="primary"
                onClick={() => {
                  setEditingDevice(null);
                  setDeviceConfigModalOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Device
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="printers" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="printers">
                  <Printer className="h-4 w-4 mr-2" />
                  Printers
                </TabsTrigger>
                <TabsTrigger value="cash-drawers">
                  <DollarSign className="h-4 w-4 mr-2" />
                  Cash Drawers
                </TabsTrigger>
                <TabsTrigger value="pagers">
                  <Radio className="h-4 w-4 mr-2" />
                  Pagers
                </TabsTrigger>
                <TabsTrigger value="scanners">
                  <Barcode className="h-4 w-4 mr-2" />
                  Scanners
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
                    <div className="col-span-full text-center py-8 text-gray-500">
                      No printers configured
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
                    <div className="col-span-full text-center py-8 text-gray-500">
                      No cash drawers configured
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
                    <div className="col-span-full text-center py-8 text-gray-500">
                      No pagers configured
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
                    <div className="col-span-full text-center py-8 text-gray-500">
                      No barcode scanners configured
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Other Integrations */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Other Integrations</CardTitle>
            <Button variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Add Integration
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12">
              <p className="text-gray-600">Loading integrations...</p>
            </div>
          ) : regularIntegrations && regularIntegrations.length === 0 ? (
            <div className="text-center py-12">
              <Plug className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-4">No integrations configured yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {regularIntegrations?.map((integration) => (
                <div
                  key={integration.id}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div
                      className={`p-3 rounded-lg ${
                        integration.isEnabled ? 'bg-green-100' : 'bg-gray-100'
                      }`}
                    >
                      <Plug
                        className={`h-5 w-5 ${
                          integration.isEnabled ? 'text-green-600' : 'text-gray-400'
                        }`}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900">
                          {integration.provider}
                        </h3>
                        {integration.isEnabled ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="default">Inactive</Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">
                        {getIntegrationTypeLabel(integration.integrationType)} •{' '}
                        {integration.provider}
                        {integration.lastSyncedAt &&
                          ` • Last synced: ${new Date(
                            integration.lastSyncedAt
                          ).toLocaleString()}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleToggleIntegration(integration.id, integration.isEnabled)
                      }
                    >
                      {integration.isEnabled ? (
                        <>
                          <PowerOff className="h-4 w-4 mr-1" />
                          Disable
                        </>
                      ) : (
                        <>
                          <Power className="h-4 w-4 mr-1" />
                          Enable
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteIntegration(integration.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
    </div>
  );
};

export default IntegrationsSettingsPage;
