// Tauri API wrapper
// This file provides a clean interface to Tauri desktop features
// Falls back gracefully when running in browser mode

import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import { sendNotification } from '@tauri-apps/api/notification';

// Check if running in Tauri
export const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

// Printer types
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
    await appWindow.minimize();
  }

  /**
   * Maximize window
   */
  static async maximize(): Promise<void> {
    if (!isTauri()) return;
    await appWindow.toggleMaximize();
  }

  /**
   * Close window
   */
  static async close(): Promise<void> {
    if (!isTauri()) {
      window.close();
      return;
    }
    await appWindow.close();
  }

  /**
   * Set window to fullscreen
   */
  static async setFullscreen(fullscreen: boolean): Promise<void> {
    if (!isTauri()) return;
    await appWindow.setFullscreen(fullscreen);
  }

  /**
   * Check if window is maximized
   */
  static async isMaximized(): Promise<boolean> {
    if (!isTauri()) return false;
    return await appWindow.isMaximized();
  }

  /**
   * Set window always on top
   */
  static async setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
    if (!isTauri()) return;
    await appWindow.setAlwaysOnTop(alwaysOnTop);
  }
}

// Notification Service
export class NotificationService {
  /**
   * Send a desktop notification
   */
  static async send(title: string, body: string): Promise<void> {
    if (!isTauri()) {
      // Fallback to browser notifications
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      }
      return;
    }

    try {
      await sendNotification({ title, body });
    } catch (error) {
      console.error('Failed to send notification:', error);
    }
  }

  /**
   * Request notification permission
   */
  static async requestPermission(): Promise<boolean> {
    if (!isTauri()) {
      // Browser notification permission
      if ('Notification' in window) {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
      }
      return false;
    }

    // Tauri notifications don't need permission
    return true;
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
  PrinterService,
  WindowService,
  NotificationService,
  setupKeyboardShortcuts,
};
