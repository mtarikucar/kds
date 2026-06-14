import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runReceiptSideEffects, type RunReceiptSideEffectsDeps } from './posReceipt';
import type { Payment } from '../../types';
import type { ReceiptSnapshot } from '../../types/hardware';

const SNAPSHOT = { id: 'snap-1' } as unknown as ReceiptSnapshot;

function makeDeps(over: Partial<RunReceiptSideEffectsDeps> = {}) {
  const printReceipt = vi.fn().mockResolvedValue('ok');
  const openCashDrawer = vi.fn().mockResolvedValue('ok');
  const toastError = vi.fn();
  const deps: RunReceiptSideEffectsDeps = {
    isTauri: () => true,
    getPrinterId: () => 'printer-1',
    hardware: { printReceipt, openCashDrawer },
    toast: { error: toastError },
    t: (_key, fallback) => fallback,
    ...over,
  };
  return { deps, printReceipt, openCashDrawer, toastError };
}

const payment = (snapshot: ReceiptSnapshot | null = SNAPSHOT): Pick<Payment, 'receiptSnapshot'> =>
  ({ receiptSnapshot: snapshot });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('runReceiptSideEffects — Tauri gate', () => {
  it('does NOTHING on the web (isTauri false): no print, no drawer', () => {
    const { deps, printReceipt, openCashDrawer } = makeDeps({ isTauri: () => false });
    runReceiptSideEffects(payment(), 'CASH', deps);
    expect(printReceipt).not.toHaveBeenCalled();
    expect(openCashDrawer).not.toHaveBeenCalled();
  });

  it('prints the persisted snapshot to the default printer in desktop mode', () => {
    const { deps, printReceipt } = makeDeps();
    runReceiptSideEffects(payment(), 'CARD', deps);
    expect(printReceipt).toHaveBeenCalledTimes(1);
    expect(printReceipt).toHaveBeenCalledWith('printer-1', SNAPSHOT);
  });

  it('does not print when there is no configured default printer', () => {
    const { deps, printReceipt, openCashDrawer } = makeDeps({ getPrinterId: () => null });
    runReceiptSideEffects(payment(), 'CASH', deps);
    expect(printReceipt).not.toHaveBeenCalled();
    expect(openCashDrawer).not.toHaveBeenCalled();
  });

  it('does not print when the payment has no receiptSnapshot', () => {
    const { deps, printReceipt } = makeDeps();
    runReceiptSideEffects(payment(null), 'CARD', deps);
    expect(printReceipt).not.toHaveBeenCalled();
  });
});

describe('runReceiptSideEffects — cash drawer', () => {
  it('pops the drawer ONLY for CASH payments', () => {
    const { deps, openCashDrawer } = makeDeps();
    runReceiptSideEffects(payment(), 'CASH', deps);
    expect(openCashDrawer).toHaveBeenCalledTimes(1);
    expect(openCashDrawer).toHaveBeenCalledWith('printer-1');
  });

  it('does NOT pop the drawer for non-cash payments', () => {
    const { deps, openCashDrawer } = makeDeps();
    runReceiptSideEffects(payment(), 'CARD', deps);
    expect(openCashDrawer).not.toHaveBeenCalled();
  });

  it('does not pop the drawer for CASH without a printer', () => {
    const { deps, openCashDrawer } = makeDeps({ getPrinterId: () => null });
    runReceiptSideEffects(payment(), 'CASH', deps);
    expect(openCashDrawer).not.toHaveBeenCalled();
  });
});

describe('runReceiptSideEffects — print-failure UX', () => {
  it('toasts a Reprint action when the initial print rejects', async () => {
    const printReceipt = vi.fn().mockRejectedValueOnce(new Error('offline'));
    const toastError = vi.fn();
    const { deps } = makeDeps({
      hardware: { printReceipt, openCashDrawer: vi.fn().mockResolvedValue('ok') },
      toast: { error: toastError },
    });

    runReceiptSideEffects(payment(), 'CARD', deps);
    // let the rejected printReceipt promise settle
    await Promise.resolve();
    await Promise.resolve();

    expect(toastError).toHaveBeenCalledTimes(1);
    const [message, opts] = toastError.mock.calls[0];
    expect(message).toBe('Receipt print failed — payment recorded.');
    expect(opts.duration).toBe(10_000);
    expect(opts.action.label).toBe('Reprint Receipt');
  });

  it('Reprint action re-sends the SAME persisted snapshot (byte-identical reprint)', async () => {
    const printReceipt = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline')) // initial
      .mockResolvedValueOnce('ok'); // reprint
    const toastError = vi.fn();
    const { deps } = makeDeps({
      hardware: { printReceipt, openCashDrawer: vi.fn().mockResolvedValue('ok') },
      toast: { error: toastError },
    });

    runReceiptSideEffects(payment(), 'CARD', deps);
    await Promise.resolve();
    await Promise.resolve();

    // fire the Reprint button
    toastError.mock.calls[0][1].action.onClick();

    expect(printReceipt).toHaveBeenCalledTimes(2);
    // both calls used the same snapshot reference + printer
    expect(printReceipt.mock.calls[0]).toEqual(['printer-1', SNAPSHOT]);
    expect(printReceipt.mock.calls[1]).toEqual(['printer-1', SNAPSHOT]);
  });

  it('toasts again when the Reprint itself rejects', async () => {
    const printReceipt = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('still offline'));
    const toastError = vi.fn();
    const { deps } = makeDeps({
      hardware: { printReceipt, openCashDrawer: vi.fn().mockResolvedValue('ok') },
      toast: { error: toastError },
    });

    runReceiptSideEffects(payment(), 'CARD', deps);
    await Promise.resolve();
    await Promise.resolve();

    toastError.mock.calls[0][1].action.onClick();
    await Promise.resolve();
    await Promise.resolve();

    expect(toastError).toHaveBeenCalledTimes(2);
    expect(toastError.mock.calls[1][0]).toBe(
      'Reprint failed — check printer connection',
    );
  });

  it('swallows a cash-drawer rejection without throwing', async () => {
    const openCashDrawer = vi.fn().mockRejectedValueOnce(new Error('jammed'));
    const { deps } = makeDeps({
      hardware: { printReceipt: vi.fn().mockResolvedValue('ok'), openCashDrawer },
    });
    expect(() => runReceiptSideEffects(payment(), 'CASH', deps)).not.toThrow();
    await Promise.resolve();
    expect(openCashDrawer).toHaveBeenCalled();
  });
});
