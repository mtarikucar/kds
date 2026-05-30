import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';

/**
 * v2.8.87 — public-view helper regression.
 *
 * The public catalog endpoints (storefront list + SKU detail) must NOT
 * leak the private inventory columns: `allocated` (how many we've
 * reserved for in-flight orders), `shipped`, and most importantly
 * `serialsAvailable` (queued device serial numbers). Pre-v2.8.87 the
 * `bySku` controller route called `findBySkuOrThrow` directly which
 * `include: { inventory: true }` spread every column. v2.8.87 routes
 * the public endpoints through `findBySkuPublicOrThrow` which collapses
 * inventory[] down to a single scalar `available` field via the
 * `toPublicView()` helper.
 *
 * Internal callers (CheckoutService allocate path) keep using
 * findBySkuOrThrow — they need the full inventory row.
 */
describe('CatalogService — public view (v2.8.87)', () => {
  let prisma: any;
  let svc: CatalogService;

  beforeEach(() => {
    prisma = {
      hardwareProduct: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };
    svc = new CatalogService(prisma);
  });

  function makeRow(overrides: any = {}) {
    return {
      id: 'h-1',
      sku: 'kds-21in',
      category: 'kds_screen',
      name: '21" KDS Screen',
      status: 'published',
      priceCents: 75000,
      currency: 'TRY',
      inventory: [{ available: 7 }],
      ...overrides,
    };
  }

  describe('findBySkuPublicOrThrow', () => {
    it('returns the public-shape row with scalar `available` and no inventory[] relation', async () => {
      prisma.hardwareProduct.findUnique.mockResolvedValue(makeRow());
      const out: any = await svc.findBySkuPublicOrThrow('kds-21in');
      expect(out.available).toBe(7);
      expect(out.inventory).toBeUndefined();
    });

    it('throws NotFound for a draft/archived row (don\'t leak which SKUs exist as non-published)', async () => {
      prisma.hardwareProduct.findUnique.mockResolvedValue(makeRow({ status: 'draft' }));
      await expect(svc.findBySkuPublicOrThrow('kds-21in')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound for a missing SKU', async () => {
      prisma.hardwareProduct.findUnique.mockResolvedValue(null);
      await expect(svc.findBySkuPublicOrThrow('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does NOT include serialsAvailable / allocated / shipped on the public payload (defence in depth)', async () => {
      // Even if a future schema change widens the inventory select set,
      // the public view contract is "available scalar + nothing else".
      // Prove this by feeding a row that has those private fields in
      // its inventory[] and checking they don't reach the output.
      prisma.hardwareProduct.findUnique.mockResolvedValue(
        makeRow({
          inventory: [{ available: 5, allocated: 3, shipped: 10, serialsAvailable: ['SN-001', 'SN-002'] }],
        }),
      );
      const out: any = await svc.findBySkuPublicOrThrow('kds-21in');
      expect(out.available).toBe(5);
      // Inventory relation stripped, so private fields can't appear.
      expect(out.inventory).toBeUndefined();
      expect(out.allocated).toBeUndefined();
      expect(out.shipped).toBeUndefined();
      expect(out.serialsAvailable).toBeUndefined();
    });
  });

  describe('listPublic', () => {
    it('returns published rows with the same public view (scalar `available`)', async () => {
      prisma.hardwareProduct.findMany.mockResolvedValue([
        makeRow(),
        makeRow({ id: 'h-2', sku: 'printer-80mm', name: 'Printer', inventory: [{ available: 0 }] }),
      ]);
      const out: any[] = await svc.listPublic();
      expect(out).toHaveLength(2);
      expect(out[0].available).toBe(7);
      expect(out[1].available).toBe(0);
      expect(out[0].inventory).toBeUndefined();
      expect(out[1].inventory).toBeUndefined();
    });

    it('sums available across multiple inventory rows (multi-warehouse extension is forward-safe)', async () => {
      prisma.hardwareProduct.findMany.mockResolvedValue([
        makeRow({ inventory: [{ available: 3 }, { available: 4 }, { available: 1 }] }),
      ]);
      const out: any[] = await svc.listPublic();
      expect(out[0].available).toBe(8);
    });

    it('handles a row with no inventory rows yet without throwing (returns available: 0)', async () => {
      prisma.hardwareProduct.findMany.mockResolvedValue([makeRow({ inventory: [] })]);
      const out: any[] = await svc.listPublic();
      expect(out[0].available).toBe(0);
    });
  });
});
