import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { Switch } from '@/components/ui/switch';
import { DeviceType, ConnectionType } from '@/types/hardware';

const deviceConfigSchema = z.object({
  name: z.string().min(1, 'Device name is required'),
  device_type: z.nativeEnum(DeviceType),
  connection_type: z.nativeEnum(ConnectionType),
  // Serial connection fields
  serial_port: z.string().optional(),
  baud_rate: z.number().optional(),
  // Network connection fields
  ip_address: z.string().optional(),
  port: z.number().optional(),
  protocol: z.enum(['Tcp', 'Udp']).optional(),
  // USB HID fields
  vendor_id: z.number().optional(),
  product_id: z.number().optional(),
  // Bluetooth fields
  device_address: z.string().optional(),
  // General settings
  auto_connect: z.boolean().default(true),
  timeout_ms: z.number().optional(),
});

type DeviceConfigFormData = z.infer<typeof deviceConfigSchema>;

interface DeviceConfigModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (config: any) => void;
  initialData?: Partial<DeviceConfigFormData>;
  mode?: 'create' | 'edit';
}

export function DeviceConfigModal({
  open,
  onClose,
  onSave,
  initialData,
  mode = 'create',
}: DeviceConfigModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<DeviceConfigFormData>({
    resolver: zodResolver(deviceConfigSchema),
    defaultValues: {
      name: initialData?.name || '',
      device_type: initialData?.device_type || DeviceType.THERMAL_PRINTER,
      connection_type: initialData?.connection_type || ConnectionType.SERIAL,
      auto_connect: initialData?.auto_connect !== false,
      baud_rate: initialData?.baud_rate || 9600,
      port: initialData?.port || 9100,
      timeout_ms: initialData?.timeout_ms || 1000,
    },
  });

  const watchConnectionType = form.watch('connection_type');

  const handleSubmit = async (data: DeviceConfigFormData) => {
    setIsSubmitting(true);
    try {
      // Build connection config based on type
      let connectionConfig: any = {};

      switch (data.connection_type) {
        case ConnectionType.SERIAL:
          connectionConfig = {
            port: data.serial_port,
            baud_rate: data.baud_rate,
            timeout_ms: data.timeout_ms,
          };
          break;
        case ConnectionType.NETWORK:
          connectionConfig = {
            ip_address: data.ip_address,
            port: data.port,
            protocol: data.protocol,
            timeout_ms: data.timeout_ms,
          };
          break;
        case ConnectionType.USB_HID:
          connectionConfig = {
            vendor_id: data.vendor_id,
            product_id: data.product_id,
            timeout_ms: data.timeout_ms,
          };
          break;
        case ConnectionType.BLUETOOTH:
          connectionConfig = {
            device_address: data.device_address,
          };
          break;
      }

      const config = {
        integrationType: data.device_type,
        provider: data.name,
        isEnabled: true,
        configuration: {
          connection_type: data.connection_type,
          connection_config: connectionConfig,
          auto_connect: data.auto_connect,
        },
      };

      await onSave(config);
      onClose();
    } catch (error) {
      console.error('Failed to save device config:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'Add Hardware Device' : 'Edit Hardware Device'}
          </DialogTitle>
          <DialogDescription>
            Configure your hardware device connection settings
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Device Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Main Receipt Printer" {...field} />
                  </FormControl>
                  <FormDescription>
                    A friendly name to identify this device
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="device_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Device Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select device type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={DeviceType.THERMAL_PRINTER}>
                        Thermal Printer
                      </SelectItem>
                      <SelectItem value={DeviceType.CASH_DRAWER}>Cash Drawer</SelectItem>
                      <SelectItem value={DeviceType.RESTAURANT_PAGER}>
                        Restaurant Pager
                      </SelectItem>
                      <SelectItem value={DeviceType.BARCODE_READER}>
                        Barcode Reader
                      </SelectItem>
                      <SelectItem value={DeviceType.CUSTOMER_DISPLAY}>
                        Customer Display
                      </SelectItem>
                      <SelectItem value={DeviceType.KITCHEN_DISPLAY}>
                        Kitchen Display
                      </SelectItem>
                      <SelectItem value={DeviceType.SCALE_DEVICE}>Scale Device</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="connection_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Connection Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select connection type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={ConnectionType.SERIAL}>
                        Serial (RS-232/USB)
                      </SelectItem>
                      <SelectItem value={ConnectionType.NETWORK}>
                        Network (TCP/IP)
                      </SelectItem>
                      <SelectItem value={ConnectionType.USB_HID}>USB HID</SelectItem>
                      <SelectItem value={ConnectionType.BLUETOOTH}>Bluetooth</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Serial Connection Fields */}
            {watchConnectionType === ConnectionType.SERIAL && (
              <>
                <FormField
                  control={form.control}
                  name="serial_port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Serial Port</FormLabel>
                      <FormControl>
                        <Input placeholder="COM1 or /dev/ttyUSB0" {...field} />
                      </FormControl>
                      <FormDescription>
                        Windows: COM1, COM2, etc. | Linux: /dev/ttyUSB0, /dev/ttyS0
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="baud_rate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Baud Rate</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(parseInt(value))}
                        defaultValue={field.value?.toString()}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select baud rate" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="9600">9600</SelectItem>
                          <SelectItem value="19200">19200</SelectItem>
                          <SelectItem value="38400">38400</SelectItem>
                          <SelectItem value="57600">57600</SelectItem>
                          <SelectItem value="115200">115200</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {/* Network Connection Fields */}
            {watchConnectionType === ConnectionType.NETWORK && (
              <>
                <FormField
                  control={form.control}
                  name="ip_address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>IP Address</FormLabel>
                      <FormControl>
                        <Input placeholder="192.168.1.100" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Port</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="9100"
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="protocol"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Protocol</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select protocol" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Tcp">TCP</SelectItem>
                          <SelectItem value="Udp">UDP</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {/* USB HID Connection Fields */}
            {watchConnectionType === ConnectionType.USB_HID && (
              <>
                <FormField
                  control={form.control}
                  name="vendor_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vendor ID (Hex)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="0x1234"
                          {...field}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(parseInt(value, 16));
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        USB Vendor ID in hexadecimal format (e.g., 0x04B8)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="product_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product ID (Hex)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="0x5678"
                          {...field}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(parseInt(value, 16));
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        USB Product ID in hexadecimal format (e.g., 0x0202)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {/* Bluetooth Connection Fields */}
            {watchConnectionType === ConnectionType.BLUETOOTH && (
              <FormField
                control={form.control}
                name="device_address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bluetooth MAC Address</FormLabel>
                    <FormControl>
                      <Input placeholder="00:11:22:33:44:55" {...field} />
                    </FormControl>
                    <FormDescription>
                      The Bluetooth MAC address of the device
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="auto_connect"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Auto Connect</FormLabel>
                    <FormDescription>
                      Automatically connect to this device on startup
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : mode === 'create' ? 'Add Device' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
