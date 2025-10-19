// Hardware Device Types
export enum DeviceType {
  THERMAL_PRINTER = 'THERMAL_PRINTER',
  CASH_DRAWER = 'CASH_DRAWER',
  RESTAURANT_PAGER = 'RESTAURANT_PAGER',
  BARCODE_READER = 'BARCODE_READER',
  CUSTOMER_DISPLAY = 'CUSTOMER_DISPLAY',
  KITCHEN_DISPLAY = 'KITCHEN_DISPLAY',
  SCALE_DEVICE = 'SCALE_DEVICE',
}

export enum ConnectionType {
  SERIAL = 'Serial',
  NETWORK = 'Network',
  USB_HID = 'UsbHid',
  BLUETOOTH = 'Bluetooth',
}

export enum ConnectionStatus {
  CONNECTED = 'Connected',
  DISCONNECTED = 'Disconnected',
  CONNECTING = 'Connecting',
  ERROR = 'Error',
}

export enum HealthStatus {
  HEALTHY = 'Healthy',
  WARNING = 'Warning',
  ERROR = 'Error',
  UNKNOWN = 'Unknown',
}

export enum PaperStatus {
  OK = 'Ok',
  LOW = 'Low',
  OUT = 'Out',
  UNKNOWN = 'Unknown',
}

export enum BarcodeType {
  CODE39 = 'Code39',
  CODE128 = 'Code128',
  EAN13 = 'Ean13',
  EAN8 = 'Ean8',
  UPCA = 'Upca',
  UPCE = 'Upce',
}

// Connection Configurations
export interface SerialConnectionConfig {
  port: string;
  baud_rate: number;
  timeout_ms?: number;
}

export interface NetworkConnectionConfig {
  ip_address: string;
  port: number;
  protocol: 'Tcp' | 'Udp';
  timeout_ms?: number;
}

export interface UsbHidConnectionConfig {
  vendor_id: number;
  product_id: number;
  timeout_ms?: number;
}

export interface BluetoothConnectionConfig {
  device_address: string;
  service_uuid?: string;
  characteristic_uuid?: string;
}

export type ConnectionConfig =
  | { connection_type: 'Serial'; config: SerialConnectionConfig }
  | { connection_type: 'Network'; config: NetworkConnectionConfig }
  | { connection_type: 'UsbHid'; config: UsbHidConnectionConfig }
  | { connection_type: 'Bluetooth'; config: BluetoothConnectionConfig };

// Device Configuration
export interface DeviceConfig {
  id: string;
  name: string;
  device_type: DeviceType;
  enabled: boolean;
  auto_connect: boolean;
  connection: ConnectionConfig;
  settings?: Record<string, any>;
}

export interface HardwareConfig {
  devices: DeviceConfig[];
}

// Device Status
export interface DeviceStatus {
  id: string;
  name: string;
  device_type: DeviceType;
  connection_status: ConnectionStatus;
  health: HealthStatus;
  last_activity?: string;
  error_message?: string;
}

// Hardware Events
export type HardwareEvent =
  | {
      type: 'DeviceConnected';
      data: {
        device_id: string;
        device_name: string;
        timestamp: string;
      };
    }
  | {
      type: 'DeviceDisconnected';
      data: {
        device_id: string;
        device_name: string;
        timestamp: string;
      };
    }
  | {
      type: 'ConnectionError';
      data: {
        device_id: string;
        error: string;
        timestamp: string;
      };
    }
  | {
      type: 'PaperOut';
      data: {
        device_id: string;
        timestamp: string;
      };
    }
  | {
      type: 'PaperLow';
      data: {
        device_id: string;
        timestamp: string;
      };
    }
  | {
      type: 'CashDrawerOpened';
      data: {
        device_id: string;
        timestamp: string;
      };
    }
  | {
      type: 'BarcodeScanned';
      data: {
        device_id: string;
        barcode_data: string;
        barcode_type: string;
        timestamp: string;
      };
    }
  | {
      type: 'PagerCalled';
      data: {
        device_id: string;
        pager_number: number;
        timestamp: string;
      };
    }
  | {
      type: 'DeviceError';
      data: {
        device_id: string;
        error: string;
        timestamp: string;
      };
    };

// Printing Data Types
export interface ReceiptItem {
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  modifiers?: string[];
}

export interface ReceiptData {
  order_id: string;
  table_number?: string;
  timestamp: string;
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  total: number;
  payment_method: string;
}

export interface KitchenOrderItem {
  name: string;
  quantity: number;
  modifiers?: string[];
  cooking_instructions?: string;
}

export interface KitchenOrderData {
  order_id: string;
  table_number?: string;
  timestamp: string;
  items: KitchenOrderItem[];
  special_instructions?: string;
}

export enum TextAlignment {
  LEFT = 'Left',
  CENTER = 'Center',
  RIGHT = 'Right',
}

export interface TextStyle {
  bold?: boolean;
  underline?: boolean;
  double_height?: boolean;
  double_width?: boolean;
}
