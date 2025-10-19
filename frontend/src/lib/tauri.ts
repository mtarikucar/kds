// Tauri API wrapper
// This file provides a clean interface to Tauri desktop features
// Falls back gracefully when running in browser mode

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import type {
  DeviceConfig,
  DeviceStatus,
  HardwareConfig,
  HardwareEvent,
  ReceiptData as NewReceiptData,
  KitchenOrderData,
  TextAlignment,
  TextStyle,
  BarcodeType,
} from '../types/hardware';

// Check if running in Tauri
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

// Hardware Service - New unified hardware management API
export class HardwareService {
  /**
   * Initialize hardware manager with backend URL
   */
  static async initialize(backendUrl: string): Promise<string> {
    if (!isTauri()) {
      console.warn('Hardware service only available in desktop mode');
      return 'Hardware service not available in web mode';
    }

    try {
      return await invoke<string>('initialize_hardware', { backendUrl });
    } catch (error) {
      console.error('Failed to initialize hardware:', error);
      throw error;
    }
  }

  /**
   * List all configured hardware devices
   */
  static async listDevices(): Promise<DeviceStatus[]> {
    if (!isTauri()) {
      return [];
    }

    try {
      return await invoke<DeviceStatus[]>('list_devices');
    } catch (error) {
      console.error('Failed to list devices:', error);
      throw error;
    }
  }

  /**
   * Get status of a specific device
   */
  static async getDeviceStatus(deviceId: string): Promise<DeviceStatus> {
    if (!isTauri()) {
      throw new Error('Hardware service only available in desktop mode');
    }

    try {
      return await invoke<DeviceStatus>('get_device_status', { deviceId });
    } catch (error) {
      console.error('Failed to get device status:', error);
      throw error;
    }
  }

  /**
   * Connect to a specific device
   */
  static async connectDevice(deviceId: string): Promise<string> {
    if (!isTauri()) {
      throw new Error('Hardware service only available in desktop mode');
    }

    try {
      return await invoke<string>('connect_device', { deviceId });
    } catch (error) {
      console.error('Failed to connect device:', error);
      throw error;
    }
  }

  /**
   * Disconnect from a specific device
   */
  static async disconnectDevice(deviceId: string): Promise<string> {
    if (!isTauri()) {
      throw new Error('Hardware service only available in desktop mode');
    }

    try {
      return await invoke<string>('disconnect_device', { deviceId });
    } catch (error) {
      console.error('Failed to disconnect device:', error);
      throw error;
    }
  }

  /**
   * Test a device to verify it's working
   */
  static async testDevice(deviceId: string): Promise<string> {
    if (!isTauri()) {
      throw new Error('Hardware service only available in desktop mode');
    }

    try {
      return await invoke<string>('test_device', { deviceId });
    } catch (error) {
      console.error('Failed to test device:', error);
      throw error;
    }
  }

  /**
   * Print receipt to a specific printer device
   */
  static async printReceipt(
    deviceId: string,
    receipt: NewReceiptData
  ): Promise<string> {
    if (!isTauri()) {
      console.warn('Hardware printing only available in desktop mode');
      window.print();
      return 'Printed using browser';
    }

    try {
      return await invoke<string>('print_receipt', { deviceId, receipt });
    } catch (error) {
      console.error('Failed to print receipt:', error);
      throw error;
    }
  }

  /**
   * Print kitchen order to a specific printer device
   */
  static async printKitchenOrder(
    deviceId: string,
    order: KitchenOrderData
  ): Promise<string> {
    if (!isTauri()) {
      throw new Error('Hardware printing only available in desktop mode');
    }

    try {
      return await invoke<string>('print_kitchen_order', { deviceId, order });
    } catch (error) {
      console.error('Failed to print kitchen order:', error);
      throw error;
    }
  }

  /**
   * Open cash drawer via printer
   */
  static async openCashDrawer(deviceId: string): Promise<string> {
    if (!isTauri()) {
      throw new Error('Hardware control only available in desktop mode');
    }

    try {
      return await invoke<string>('open_cash_drawer', { deviceId });
    } catch (error) {
      console.error('Failed to open cash drawer:', error);
      throw error;
    }
  }

  /**
   * Call a restaurant pager
   */
  static async callPager(
    deviceId: string,
    pagerNumber: number,
    alertType?: string
  ): Promise<string> {
    if (!isTauri()) {
      throw new Error('Hardware control only available in desktop mode');
    }

    try {
      return await invoke<string>('call_pager', {
        deviceId,
        pagerNumber,
        alertType,
      });
    } catch (error) {
      console.error('Failed to call pager:', error);
      throw error;
    }
  }

  /**
   * Listen for hardware events
   */
  static async listenToHardwareEvents(
    callback: (event: HardwareEvent) => void
  ): Promise<() => void> {
    if (!isTauri()) {
      return () => {}; // No-op unsubscribe
    }

    try {
      const unlisten = await listen<HardwareEvent>('hardware-event', (event) => {
        callback(event.payload);
      });
      return unlisten;
    } catch (error) {
      console.error('Failed to listen to hardware events:', error);
      return () => {};
    }
  }
}

// Printer types
// @deprecated - Use HardwareService instead
export interface PrinterInfo {
  name: string;
  port: string;
  status: string;
}

export interface ReceiptData {
  order_id: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  total: number;
  payment_method: string;
  table_number?: string;
}

// Printer Service
export class PrinterService {
  /**
   * List all available printers
   */
  static async listPrinters(): Promise<PrinterInfo[]> {
    if (!isTauri()) {
      console.warn('Printer service only available in desktop mode');
      return [];
    }

    try {
      return await invoke<PrinterInfo[]>('list_printers');
    } catch (error) {
      console.error('Failed to list printers:', error);
      throw error;
    }
  }

  /**
   * Set the default printer
   */
  static async setPrinter(port: string): Promise<string> {
    if (!isTauri()) {
      throw new Error('Printer service only available in desktop mode');
    }

    try {
      return await invoke<string>('set_printer', { port });
    } catch (error) {
      console.error('Failed to set printer:', error);
      throw error;
    }
  }

  /**
   * Get current configured printer
   */
  static async getPrinter(): Promise<string | null> {
    if (!isTauri()) {
      return null;
    }

    try {
      return await invoke<string | null>('get_printer');
    } catch (error) {
      console.error('Failed to get printer:', error);
      return null;
    }
  }

  /**
   * Print a customer receipt
   */
  static async printReceipt(receipt: ReceiptData): Promise<string> {
    if (!isTauri()) {
      // Fallback to browser print
      console.log('Falling back to browser print');
      window.print();
      return 'Printed using browser';
    }

    try {
      return await invoke<string>('print_receipt', { receipt });
    } catch (error) {
      console.error('Failed to print receipt:', error);
      throw error;
    }
  }

  /**
   * Print a kitchen order ticket
   */
  static async printKitchenOrder(receipt: ReceiptData): Promise<string> {
    if (!isTauri()) {
      console.warn('Kitchen printer only available in desktop mode');
      return 'Kitchen printer not available in web mode';
    }

    try {
      return await invoke<string>('print_kitchen_order', { receipt });
    } catch (error) {
      console.error('Failed to print kitchen order:', error);
      throw error;
    }
  }

  /**
   * Open cash drawer
   */
  static async openCashDrawer(): Promise<string> {
    if (!isTauri()) {
      throw new Error('Cash drawer only available in desktop mode');
    }

    try {
      return await invoke<string>('open_cash_drawer');
    } catch (error) {
      console.error('Failed to open cash drawer:', error);
      throw error;
    }
  }
}

// Window Management
export class WindowService {
  /**
   * Minimize window
   */
  static async minimize(): Promise<void> {
    if (!isTauri()) return;
    await getCurrentWindow().minimize();
  }

  /**
   * Maximize window
   */
  static async maximize(): Promise<void> {
    if (!isTauri()) return;
    await getCurrentWindow().toggleMaximize();
  }

  /**
   * Close window
   */
  static async close(): Promise<void> {
    if (!isTauri()) {
      window.close();
      return;
    }
    await getCurrentWindow().close();
  }

  /**
   * Set window to fullscreen
   */
  static async setFullscreen(fullscreen: boolean): Promise<void> {
    if (!isTauri()) return;
    await getCurrentWindow().setFullscreen(fullscreen);
  }

  /**
   * Check if window is maximized
   */
  static async isMaximized(): Promise<boolean> {
    if (!isTauri()) return false;
    return await getCurrentWindow().isMaximized();
  }

  /**
   * Set window always on top
   */
  static async setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
    if (!isTauri()) return;
    await getCurrentWindow().setAlwaysOnTop(alwaysOnTop);
  }
}

// Notification Service
export class NotificationService {
  /**
   * Send a desktop notification
   */
  static async send(title: string, body: string): Promise<void> {
    // Use browser notifications for both web and Tauri
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, { body });
      } else if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          new Notification(title, { body });
        }
      }
    }
  }

  /**
   * Request notification permission
   */
  static async requestPermission(): Promise<boolean> {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    return false;
  }
}

// Keyboard Shortcuts
export const setupKeyboardShortcuts = () => {
  if (!isTauri()) return;

  // F11 - Toggle fullscreen
  document.addEventListener('keydown', async (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      const isMax = await WindowService.isMaximized();
      await WindowService.setFullscreen(!isMax);
    }
  });
};

export default {
  isTauri,
  HardwareService,
  PrinterService, // Deprecated
  WindowService,
  NotificationService,
  setupKeyboardShortcuts,
};
