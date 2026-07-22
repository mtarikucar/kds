import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Specs for usePosSocket — the POS live cache engine. The transport seam
 * is lib/socket; the hardware seam is lib/tauri (isTauri + HardwareService).
 * We drive the captured event handlers and assert the branch-scoped
 * optimistic cache writes, the request-panel insert/remove transitions,
 * the table-transfer cache move, and the payment:success "skip my own
 * action" print guard. Stores are mocked at the getState() level.
 */

const handlers: Record<string, (e?: any) => void> = {};
const fakeSocket = {
  on: vi.fn((event: string, cb: (e?: any) => void) => {
    handlers[event] = cb;
  }),
  off: vi.fn(),
};
const initializeSocket = vi.fn(() => fakeSocket);
const disconnectSocket = vi.fn();
vi.mock('../../lib/socket', () => ({
  initializeSocket: () => initializeSocket(),
  disconnectSocket: () => disconnectSocket(),
}));

let tauri = false;
const printKitchenOrder = vi.fn().mockResolvedValue(undefined);
const printReceipt = vi.fn().mockResolvedValue(undefined);
const openCashDrawer = vi.fn().mockResolvedValue(undefined);
vi.mock('../../lib/tauri', () => ({
  isTauri: () => tauri,
  HardwareService: {
    printKitchenOrder: (...a: unknown[]) => printKitchenOrder(...a),
    printReceipt: (...a: unknown[]) => printReceipt(...a),
    openCashDrawer: (...a: unknown[]) => openCashDrawer(...a),
  },
}));

const toastWarning = vi.fn();
vi.mock('sonner', () => ({
  toast: { warning: (...a: unknown[]) => toastWarning(...a), info: vi.fn(), success: vi.fn() },
}));
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));

let uiState = { defaultKitchenPrinterId: null as string | null, defaultReceiptPrinterId: null as string | null };
let authState = { user: { id: 'me' } as { id: string } | null };
const branchState = { branchId: 'b-1' };
vi.mock('../../store/uiStore', () => ({ useUiStore: { getState: () => uiState } }));
vi.mock('../../store/authStore', () => ({ useAuthStore: { getState: () => authState } }));
vi.mock('../../store/branchScopeStore', () => ({ useBranchScopeStore: { getState: () => branchState } }));

import { usePosSocket } from './usePosSocket';

function wrapper(client: QueryClient) {
  return ({ children }: any) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(handlers)) delete handlers[k];
  tauri = false;
  uiState = { defaultKitchenPrinterId: null, defaultReceiptPrinterId: null };
  authState = { user: { id: 'me' } };
  // Stub a minimal AudioContext so playNotificationSound doesn't throw.
  (window as any).AudioContext = class {
    currentTime = 0;
    destination = {};
    createOscillator() {
      return { connect: vi.fn(), frequency: {}, type: '', start: vi.fn(), stop: vi.fn() };
    }
    createGain() {
      return { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } };
    }
  };
});

describe('usePosSocket — wiring + connection', () => {
  it('subscribes to the POS event set and reflects connect/disconnect', () => {
    const client = new QueryClient();
    const { result } = renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    expect(fakeSocket.on).toHaveBeenCalledWith('order:new', expect.any(Function));
    expect(fakeSocket.on).toHaveBeenCalledWith('payment:success', expect.any(Function));
    expect(fakeSocket.on).toHaveBeenCalledWith('bill-request:new', expect.any(Function));
    expect(fakeSocket.on).toHaveBeenCalledWith('stock:low-alert', expect.any(Function));
    expect(fakeSocket.on).toHaveBeenCalledWith('stock:expiry-alert', expect.any(Function));
    expect(fakeSocket.on).toHaveBeenCalledWith('floor:layout-updated', expect.any(Function));

    act(() => handlers['connect']());
    expect(result.current.isConnected).toBe(true);
    act(() => handlers['disconnect']());
    expect(result.current.isConnected).toBe(false);
  });
});

describe('handleNewOrder — branch-scoped optimistic writes', () => {
  it('prepends a requiresApproval order into the branch-scoped pending cache', () => {
    const client = new QueryClient();
    client.setQueryData(['orders', 'pending', 'b-1'], [{ id: 'old' }]);
    renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    act(() => handlers['order:new']({ id: 'new', requiresApproval: true, orderNumber: 'O-1' }));

    const pending = client.getQueryData<any[]>(['orders', 'pending', 'b-1'])!;
    expect(pending.map((o) => o.id)).toEqual(['new', 'old']);
  });

  it('inserts a table order into the table-scoped cache key', () => {
    const client = new QueryClient();
    const tableKey = ['orders', { tableId: 't-7', status: 'PENDING,PREPARING,READY,SERVED' }, 'b-1'];
    client.setQueryData(tableKey, []);
    renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    act(() => handlers['order:new']({ id: 'n2', tableId: 't-7', status: 'PENDING' }));

    expect(client.getQueryData<any[]>(tableKey)!.map((o) => o.id)).toEqual(['n2']);
  });
});

describe('handleNewOrder — tauri print gate', () => {
  it('prints the kitchen ticket on Tauri with a configured printer + snapshot', () => {
    tauri = true;
    uiState.defaultKitchenPrinterId = 'printer-1';
    const client = new QueryClient();
    renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    act(() => handlers['order:new']({ id: 'n', kitchenTicketSnapshot: { lines: [] } }));
    expect(printKitchenOrder).toHaveBeenCalledWith('printer-1', { lines: [] });
  });

  it('does NOT print on the web (isTauri false)', () => {
    tauri = false;
    uiState.defaultKitchenPrinterId = 'printer-1';
    const client = new QueryClient();
    renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    act(() => handlers['order:new']({ id: 'n', kitchenTicketSnapshot: { lines: [] } }));
    expect(printKitchenOrder).not.toHaveBeenCalled();
  });
});

describe('handleBillRequestNew / Updated — panel list maintenance', () => {
  it('prepends a new bill request to the branch-scoped list', () => {
    const client = new QueryClient();
    client.setQueryData(['billRequests', 'b-1'], [{ id: 'br-old' }]);
    renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    act(() => handlers['bill-request:new']({ id: 'br-new' }));
    expect(client.getQueryData<any[]>(['billRequests', 'b-1'])!.map((r) => r.id)).toEqual(['br-new', 'br-old']);
  });

  it('removes a bill request from the list once it is COMPLETED', () => {
    const client = new QueryClient();
    client.setQueryData(['billRequests', 'b-1'], [{ id: 'br-1' }, { id: 'br-2' }]);
    renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    act(() => handlers['bill-request:updated']({ id: 'br-1', status: 'COMPLETED' }));
    expect(client.getQueryData<any[]>(['billRequests', 'b-1'])!.map((r) => r.id)).toEqual(['br-2']);
  });
});

describe('handleTableTransfer — cache move', () => {
  it('clears the source table cache and prepends the orders to the target', () => {
    const client = new QueryClient();
    const status = 'PENDING,PREPARING,READY,SERVED';
    const sourceKey = ['orders', { tableId: 's', status }, 'b-1'];
    const targetKey = ['orders', { tableId: 't', status }, 'b-1'];
    client.setQueryData(sourceKey, [{ id: 'o1' }]);
    client.setQueryData(targetKey, [{ id: 'existing' }]);
    renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    act(() =>
      handlers['table:orders-transferred']({
        sourceTableId: 's',
        targetTableId: 't',
        orders: [{ id: 'o1' }],
        transferredCount: 1,
      }),
    );

    expect(client.getQueryData<any[]>(sourceKey)).toEqual([]);
    expect(client.getQueryData<any[]>(targetKey)!.map((o) => o.id)).toEqual(['o1', 'existing']);
  });
});

describe('handlePaymentSuccess — self-action print guard', () => {
  it('always invalidates order/payment caches', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    act(() => handlers['payment:success']({ initiatedByUserId: 'someone-else' }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['orders'], refetchType: 'all' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['payments'] });
  });

  it('skips the local print when THIS tablet initiated the payment', () => {
    tauri = true;
    uiState.defaultReceiptPrinterId = 'rp-1';
    authState = { user: { id: 'me' } };
    const client = new QueryClient();
    renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    act(() => handlers['payment:success']({ initiatedByUserId: 'me', receiptSnapshot: {} }));
    expect(printReceipt).not.toHaveBeenCalled();
  });

  it('prints (and opens the drawer for CASH) for a payment initiated elsewhere on Tauri', () => {
    tauri = true;
    uiState.defaultReceiptPrinterId = 'rp-1';
    authState = { user: { id: 'me' } };
    const client = new QueryClient();
    renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    act(() =>
      handlers['payment:success']({
        initiatedByUserId: 'other',
        receiptSnapshot: { total: 10 },
        method: 'CASH',
      }),
    );
    expect(printReceipt).toHaveBeenCalledWith('rp-1', { total: 10 });
    expect(openCashDrawer).toHaveBeenCalledWith('rp-1');
  });
});

describe('handleStockAlerts — warning toasts', () => {
  it('stock:low-alert shows a POS-namespace warning toast', () => {
    const client = new QueryClient();
    renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    act(() => handlers['stock:low-alert']({ count: 4, items: [] }));
    expect(toastWarning).toHaveBeenCalledWith(
      'pos:notifications.lowStockAlert',
      expect.objectContaining({ position: 'top-right' }),
    );
  });

  it('stock:expiry-alert shows a POS-namespace warning toast', () => {
    const client = new QueryClient();
    renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    act(() => handlers['stock:expiry-alert']({ count: 1, batches: [] }));
    expect(toastWarning).toHaveBeenCalledWith(
      'pos:notifications.stockExpiryAlert',
      expect.objectContaining({ position: 'top-right' }),
    );
  });
});

describe('handleFloorLayoutUpdated — reservation auto-holds recolor live', () => {
  it('invalidates tables and floorPlan on floor:layout-updated', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderHook(() => usePosSocket(), { wrapper: wrapper(client) });

    act(() => handlers['floor:layout-updated']());
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tables'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['floorPlan'] });
  });
});

describe('usePosSocket — cleanup', () => {
  it('removes its listeners and disconnects on unmount', () => {
    const client = new QueryClient();
    const { unmount } = renderHook(() => usePosSocket(), { wrapper: wrapper(client) });
    unmount();
    expect(fakeSocket.off).toHaveBeenCalledWith('payment:success', expect.any(Function));
    expect(fakeSocket.off).toHaveBeenCalledWith('stock:low-alert', expect.any(Function));
    expect(fakeSocket.off).toHaveBeenCalledWith('stock:expiry-alert', expect.any(Function));
    expect(fakeSocket.off).toHaveBeenCalledWith('floor:layout-updated', expect.any(Function));
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
  });
});
