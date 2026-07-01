import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore, toCartItems, cartLineKey } from './cartStore';
import type { HardwareProduct } from './storeApi';

/**
 * v2.8.87 — cartStore contract regression.
 *
 * The shared cart needs to:
 *   1. Compose hardware lines at the same product+acquisition pair.
 *   2. Keep services in DISTINCT lines per (productId, branchId) so a
 *      tenant can buy "WiFi survey for branch A" + "WiFi survey for
 *      branch B" as two separate visits in one checkout.
 *   3. Re-adding a service with new preferred-dates / notes overwrites
 *      (rather than stacks) — services aren't quantitative.
 *   4. Project to wire-shape CartItem[] that the v2.8.85 intent endpoint
 *      accepts (preferredDates + notes forwarded through).
 */
describe('cartStore (v2.8.87)', () => {
  function reset() {
    useCartStore.setState({ lines: [] });
  }

  beforeEach(reset);

  function makeHardware(overrides: Partial<HardwareProduct> = {}): HardwareProduct {
    return {
      id: 'p-1',
      sku: 'yazarkasa-hugin-tiger-t300',
      category: 'yazarkasa',
      name: 'Hugin Tiger T300',
      brand: 'Hugin',
      model: 'Tiger T300',
      description: '',
      priceCents: 640000,
      rentalMonthlyCents: null,
      currency: 'TRY',
      warrantyMonths: 24,
      images: [],
      stockStatus: 'in_stock',
      ...overrides,
    };
  }

  function makeService(overrides: Partial<HardwareProduct> = {}): HardwareProduct {
    return {
      id: 'svc-1',
      sku: 'install-yazarkasa-gib',
      category: 'service',
      name: 'Yazarkasa kurulum + GİB',
      brand: null,
      model: null,
      description: '',
      priceCents: 350000,
      rentalMonthlyCents: null,
      currency: 'TRY',
      warrantyMonths: 0,
      images: [],
      stockStatus: 'in_stock',
      serviceMeta: { serviceType: 'onsite', requiresBranch: true },
      ...overrides,
    };
  }

  describe('hardware', () => {
    it('composes a second add at the same product + acquisition into a single line with incremented qty', () => {
      const p = makeHardware();
      useCartStore.getState().addHardware(p, { qty: 1, acquisition: 'sell' });
      useCartStore.getState().addHardware(p, { qty: 2, acquisition: 'sell' });
      const lines = useCartStore.getState().lines;
      expect(lines).toHaveLength(1);
      expect(lines[0].qty).toBe(3);
    });

    it('keeps "sell" and "rent" of the same product as DISTINCT lines', () => {
      const p = makeHardware({ rentalMonthlyCents: 19900 });
      useCartStore.getState().addHardware(p, { acquisition: 'sell' });
      useCartStore.getState().addHardware(p, { acquisition: 'rent' });
      expect(useCartStore.getState().lines).toHaveLength(2);
    });

    it('setQty floors at 1 (can\'t accidentally enter negative or 0 via the cart preview)', () => {
      const p = makeHardware();
      useCartStore.getState().addHardware(p, { qty: 5, acquisition: 'sell' });
      const key = cartLineKey(useCartStore.getState().lines[0]);
      useCartStore.getState().setQty(key, -3);
      expect(useCartStore.getState().lines[0].qty).toBe(1);
    });

    it('remove/setQty target ONE line — a sell + rent of the same product are independent', () => {
      const p = makeHardware({ rentalMonthlyCents: 19900 });
      const store = useCartStore.getState();
      store.addHardware(p, { qty: 2, acquisition: 'sell' });
      store.addHardware(p, { qty: 3, acquisition: 'rent' });
      expect(useCartStore.getState().lines).toHaveLength(2);

      // Bump ONLY the rent line's qty.
      const rentLine = useCartStore
        .getState()
        .lines.find((l) => l.type === 'hardware' && l.acquisition === 'rent')!;
      store.setQty(cartLineKey(rentLine), 10);
      const afterSet = useCartStore.getState().lines;
      expect(afterSet.find((l) => l.type === 'hardware' && l.acquisition === 'sell')!.qty).toBe(2);
      expect(afterSet.find((l) => l.type === 'hardware' && l.acquisition === 'rent')!.qty).toBe(10);

      // Remove ONLY the sell line; the rent line survives (pre-fix, keying on
      // productId removed BOTH).
      const sellLine = afterSet.find((l) => l.type === 'hardware' && l.acquisition === 'sell')!;
      store.remove(cartLineKey(sellLine));
      const afterRemove = useCartStore.getState().lines;
      expect(afterRemove).toHaveLength(1);
      expect(afterRemove[0].type === 'hardware' && afterRemove[0].acquisition).toBe('rent');
    });
  });

  describe('services', () => {
    it('keeps the SAME service for DIFFERENT branches as two separate lines (independent scheduling)', () => {
      const p = makeService();
      useCartStore.getState().addService(p, { branchId: 'br-1', preferredDates: ['2026-06-15'] });
      useCartStore.getState().addService(p, { branchId: 'br-2', preferredDates: ['2026-06-20'] });
      const lines = useCartStore.getState().lines;
      expect(lines).toHaveLength(2);
      expect(lines[0].type).toBe('service');
      expect(lines[1].type).toBe('service');
    });

    it('re-adding a service with the SAME branch overwrites preferred-dates + notes (not stacked)', () => {
      const p = makeService();
      useCartStore.getState().addService(p, { branchId: 'br-1', preferredDates: ['2026-06-15'], notes: 'first' });
      useCartStore.getState().addService(p, { branchId: 'br-1', preferredDates: ['2026-06-30'], notes: 'second' });
      const lines = useCartStore.getState().lines;
      expect(lines).toHaveLength(1);
      expect((lines[0] as any).preferredDates).toEqual(['2026-06-30']);
      expect((lines[0] as any).notes).toBe('second');
    });

    it('allows services without a branch (remote/consultation) — those go on a single shared line', () => {
      const p = makeService({ serviceMeta: { serviceType: 'remote' } });
      useCartStore.getState().addService(p, { preferredDates: ['2026-06-15'] });
      useCartStore.getState().addService(p, { preferredDates: ['2026-06-30'] });
      expect(useCartStore.getState().lines).toHaveLength(1);
    });
  });

  describe('toCartItems projection', () => {
    it('projects hardware lines to { type: hardware, sku, qty, acquisition }', () => {
      const p = makeHardware();
      useCartStore.getState().addHardware(p, { qty: 2, acquisition: 'rent' });
      const out = toCartItems(useCartStore.getState().lines);
      expect(out).toEqual([
        { type: 'hardware', sku: 'yazarkasa-hugin-tiger-t300', qty: 2, acquisition: 'rent' },
      ]);
    });

    it('projects service lines with branchId + preferredDates + notes forwarded for InstallationRequest', () => {
      const p = makeService();
      useCartStore
        .getState()
        .addService(p, { branchId: 'br-1', preferredDates: ['2026-06-15', '2026-06-18'], notes: 'mesai dışı' });
      const out = toCartItems(useCartStore.getState().lines);
      expect(out).toEqual([
        {
          type: 'service',
          code: 'install-yazarkasa-gib',
          qty: 1,
          branchId: 'br-1',
          preferredDates: ['2026-06-15', '2026-06-18'],
          notes: 'mesai dışı',
        },
      ]);
    });
  });

  it('remove deletes the targeted line, leaving other-product lines intact', () => {
    const h = makeHardware();
    const s = makeService();
    useCartStore.getState().addHardware(h, { acquisition: 'sell' });
    useCartStore.getState().addService(s, { branchId: 'br-1' });
    const hwKey = cartLineKey(
      useCartStore.getState().lines.find((l) => l.type === 'hardware')!,
    );
    useCartStore.getState().remove(hwKey);
    expect(useCartStore.getState().lines).toHaveLength(1);
    expect(useCartStore.getState().lines[0].product.id).toBe('svc-1');
  });

  it('clear empties the cart', () => {
    useCartStore.getState().addHardware(makeHardware(), { acquisition: 'sell' });
    useCartStore.getState().addService(makeService(), { branchId: 'br-1' });
    useCartStore.getState().clear();
    expect(useCartStore.getState().lines).toHaveLength(0);
  });
});
