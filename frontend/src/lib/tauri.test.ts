import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invokeMock = vi.fn();
const getCurrentWindowMock = vi.fn();
const listenMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => getCurrentWindowMock(),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...a: unknown[]) => listenMock(...a) }));

import {
  isTauri,
  HardwareService,
  PrinterService,
  WindowService,
  NotificationService,
} from './tauri';

/**
 * In web mode (`__TAURI__` absent) every service must take its documented
 * fallback path WITHOUT touching the Tauri `invoke` bridge. These tests pin
 * that boundary — the single most important contract of this wrapper, since
 * a regression here would crash the browser build on first hardware call.
 */
describe('tauri wrapper (web mode)', () => {
  beforeEach(() => {
    delete (window as any).__TAURI__;
    invokeMock.mockReset();
    getCurrentWindowMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isTauri is false when __TAURI__ is absent', () => {
    expect(isTauri()).toBe(false);
  });

  it('isTauri is true when __TAURI__ is present', () => {
    (window as any).__TAURI__ = {};
    expect(isTauri()).toBe(true);
    delete (window as any).__TAURI__;
  });

  describe('HardwareService web fallbacks', () => {
    it('initialize returns a not-available message without invoking', async () => {
      await expect(HardwareService.initialize('http://x')).resolves.toMatch(
        /not available in web mode/,
      );
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('listDevices returns an empty array', async () => {
      await expect(HardwareService.listDevices()).resolves.toEqual([]);
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('addDevice resolves to null', async () => {
      await expect(
        HardwareService.addDevice({
          id: 'd1',
          name: 'P',
          device_type: 'printer',
          enabled: true,
          auto_connect: false,
          connection: { connection_type: 'usb', config: {} },
        }),
      ).resolves.toBeNull();
    });

    it('removeDevice rejects in web mode', async () => {
      await expect(HardwareService.removeDevice('d1')).rejects.toThrow(
        /only available in desktop mode/,
      );
    });

    it('printReceipt falls back to window.print', async () => {
      const printSpy = vi
        .spyOn(window, 'print')
        .mockImplementation(() => {});
      await expect(
        HardwareService.printReceipt('d1', {} as any),
      ).resolves.toMatch(/browser/);
      expect(printSpy).toHaveBeenCalled();
    });

    it('listenToHardwareEvents returns a no-op unsubscribe', async () => {
      const unsub = await HardwareService.listenToHardwareEvents(() => {});
      expect(typeof unsub).toBe('function');
      expect(() => unsub()).not.toThrow();
      expect(listenMock).not.toHaveBeenCalled();
    });
  });

  describe('PrinterService web fallbacks', () => {
    it('listPrinters returns an empty array', async () => {
      await expect(PrinterService.listPrinters()).resolves.toEqual([]);
    });

    it('getPrinter returns null', async () => {
      await expect(PrinterService.getPrinter()).resolves.toBeNull();
    });

    it('printReceipt falls back to window.print', async () => {
      const printSpy = vi
        .spyOn(window, 'print')
        .mockImplementation(() => {});
      await expect(
        PrinterService.printReceipt({
          order_id: 'o',
          items: [],
          total: 0,
          payment_method: 'cash',
        }),
      ).resolves.toMatch(/browser/);
      expect(printSpy).toHaveBeenCalled();
    });

    it('openCashDrawer rejects in web mode', async () => {
      await expect(PrinterService.openCashDrawer()).rejects.toThrow(
        /only available in desktop mode/,
      );
    });
  });

  /**
   * Desktop mode (`__TAURI__` present): pin the EXACT Tauri command names the
   * IPC layer invokes. The Rust `invoke_handler` only registers these literal
   * names (main.rs) — a wrong string silently rejects with "command X not
   * found", which is how the cash-drawer pop and auto-print previously died.
   * The mocked `invoke` here lets us assert the command string without a real
   * Tauri runtime (the web-mode tests above never reach `invoke`).
   */
  describe('HardwareService desktop-mode command names', () => {
    beforeEach(() => {
      (window as any).__TAURI__ = {};
      invokeMock.mockReset();
      invokeMock.mockResolvedValue('ok');
    });
    afterEach(() => {
      delete (window as any).__TAURI__;
    });

    it('openCashDrawer invokes the registered "open_cash_drawer_via_printer" command', async () => {
      await HardwareService.openCashDrawer('printer-1');
      expect(invokeMock).toHaveBeenCalledWith('open_cash_drawer_via_printer', {
        deviceId: 'printer-1',
      });
    });

    it('printReceipt invokes "print_receipt" with the snapshot passed through', async () => {
      const snapshot = { version: 1 } as any;
      await HardwareService.printReceipt('printer-1', snapshot);
      expect(invokeMock).toHaveBeenCalledWith('print_receipt', {
        deviceId: 'printer-1',
        receipt: snapshot,
      });
    });

    it('printKitchenOrder invokes "print_kitchen_order" with the ticket passed through', async () => {
      const ticket = { version: 1 } as any;
      await HardwareService.printKitchenOrder('printer-1', ticket);
      expect(invokeMock).toHaveBeenCalledWith('print_kitchen_order', {
        deviceId: 'printer-1',
        ticket,
      });
    });
  });

  describe('WindowService web fallbacks', () => {
    it('minimize is a no-op that does not touch the Tauri window', async () => {
      await WindowService.minimize();
      expect(getCurrentWindowMock).not.toHaveBeenCalled();
    });

    it('isMaximized resolves false', async () => {
      await expect(WindowService.isMaximized()).resolves.toBe(false);
    });

    it('close uses window.close in web mode', async () => {
      const closeSpy = vi
        .spyOn(window, 'close')
        .mockImplementation(() => {});
      await WindowService.close();
      expect(closeSpy).toHaveBeenCalled();
      expect(getCurrentWindowMock).not.toHaveBeenCalled();
    });
  });

  describe('NotificationService', () => {
    it('requestPermission returns false when Notification is unavailable', async () => {
      const original = (window as any).Notification;
      delete (window as any).Notification;
      await expect(
        NotificationService.requestPermission(),
      ).resolves.toBe(false);
      (window as any).Notification = original;
    });

    it('requestPermission returns true when permission is granted', async () => {
      (window as any).Notification = {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      };
      await expect(
        NotificationService.requestPermission(),
      ).resolves.toBe(true);
      delete (window as any).Notification;
    });
  });
});
