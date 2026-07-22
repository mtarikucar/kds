import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    svc = new CatalogService(prisma, { append: jest.fn() } as any);
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

    it('exposes saleMode / partnerRedirect / complianceDocs on the public payload', async () => {
      // The storefront needs these to branch the CTA + render Tier-3 docs.
      prisma.hardwareProduct.findUnique.mockResolvedValue(
        makeRow({
          saleMode: 'QUOTE_ONLY',
          partnerRedirect: { partnerUrl: 'https://psp.example' },
          complianceDocs: { warrantyCertUrl: '/docs/w.pdf' },
        }),
      );
      const out: any = await svc.findBySkuPublicOrThrow('kds-21in');
      expect(out.saleMode).toBe('QUOTE_ONLY');
      expect(out.partnerRedirect).toEqual({ partnerUrl: 'https://psp.example' });
      expect(out.complianceDocs).toEqual({ warrantyCertUrl: '/docs/w.pdf' });
    });
  });

  /**
   * Task 4 — stockStatus is now DERIVED from real inventory, never read off
   * the hand-written `hardware_products.stockStatus` column. Pre-fix, the
   * seed hand-set every row to "in_stock" while hardwareInventory.available
   * defaulted to 0 — the storefront showed "in stock", the buyer paid, and
   * only then did provisioning fail with "Insufficient stock". The column
   * itself is NOT dropped (that needs a migration and is riskier); the
   * public view just stops trusting it.
   */
  describe('stockStatus — derived from inventory, not the hand-written column (Task 4)', () => {
    it('reports in_stock when available > 0, even if the stored column says otherwise', async () => {
      prisma.hardwareProduct.findUnique.mockResolvedValue(
        makeRow({ stockStatus: 'out_of_stock', inventory: [{ available: 3 }] }),
      );
      const out: any = await svc.findBySkuPublicOrThrow('kds-21in');
      expect(out.stockStatus).toBe('in_stock');
    });

    it('reports out_of_stock when available is 0, even if the stored column says "in_stock"', async () => {
      // This is the EXACT pre-fix defect: seed hand-writes "in_stock" while
      // the inventory row defaults to available=0.
      prisma.hardwareProduct.findUnique.mockResolvedValue(
        makeRow({ stockStatus: 'in_stock', inventory: [{ available: 0 }] }),
      );
      const out: any = await svc.findBySkuPublicOrThrow('kds-21in');
      expect(out.stockStatus).toBe('out_of_stock');
    });

    it('derives stockStatus per-row on listPublic too', async () => {
      prisma.hardwareProduct.findMany.mockResolvedValue([
        makeRow({ stockStatus: 'in_stock', inventory: [{ available: 5 }] }),
        makeRow({
          id: 'h-2',
          sku: 'printer-80mm',
          stockStatus: 'in_stock', // stale hand-written value
          inventory: [{ available: 0 }],
        }),
      ]);
      const out: any[] = await svc.listPublic();
      expect(out[0].stockStatus).toBe('in_stock');
      expect(out[1].stockStatus).toBe('out_of_stock');
    });
  });
});

/**
 * Regulatory sale tier (TR law) — default resolution + publish gating.
 * The tier defaults from the product category; publishing is blocked when
 * the row would render a broken/non-compliant storefront.
 */
describe('CatalogService — saleMode (regulatory tiers)', () => {
  let prisma: any;
  let svc: CatalogService;
  let captured: any;

  beforeEach(() => {
    captured = undefined;
    const tx = {
      hardwareProduct: {
        create: jest.fn(async ({ data }: any) => {
          captured = data;
          return { id: 'p1', ...data };
        }),
      },
      hardwareInventory: { create: jest.fn(async () => ({})) },
    };
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      hardwareProduct: { findUnique: jest.fn() },
    };
    svc = new CatalogService(prisma, { append: jest.fn() } as any);
  });

  const base = { name: 'X', priceCents: 1000 };

  it('defaults a yazarkasa to QUOTE_ONLY when saleMode is omitted', async () => {
    await svc.create({ sku: 'yk-x', category: 'yazarkasa', ...base });
    expect(captured.saleMode).toBe('QUOTE_ONLY');
  });

  it('defaults a printer to DIRECT_SALE when saleMode is omitted', async () => {
    await svc.create({ sku: 'pr-x', category: 'printer', ...base });
    expect(captured.saleMode).toBe('DIRECT_SALE');
  });

  it('coerces a docless scale to RECOMMENDED_ONLY (publishable, never directly sold)', async () => {
    await svc.create({ sku: 'sc-x', category: 'scale', ...base, status: 'published' });
    expect(captured.saleMode).toBe('RECOMMENDED_ONLY');
  });

  it('rejects an EXPLICIT DIRECT_SALE scale with no compliance docs (loud, not silent)', async () => {
    await expect(
      svc.create({ sku: 'sc-x2', category: 'scale', ...base, saleMode: 'DIRECT_SALE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('keeps a scale DIRECT_SALE when compliance docs are present', async () => {
    await svc.create({
      sku: 'sc-y',
      category: 'scale',
      ...base,
      saleMode: 'DIRECT_SALE',
      complianceDocs: { ceConformityUrl: '/docs/ce.pdf' },
    });
    expect(captured.saleMode).toBe('DIRECT_SALE');
  });

  it('blocks publishing a DIRECT_SALE product without compliance docs', async () => {
    await expect(
      svc.create({ sku: 'pr-y', category: 'printer', ...base, status: 'published' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('publishes a DIRECT_SALE product when compliance docs are present', async () => {
    await svc.create({
      sku: 'pr-z',
      category: 'printer',
      ...base,
      status: 'published',
      complianceDocs: { warrantyCertUrl: '/docs/w.pdf' },
    });
    expect(captured.saleMode).toBe('DIRECT_SALE');
  });

  it('blocks publishing a PARTNER_REDIRECT product without partnerRedirect.partnerUrl', async () => {
    await expect(
      svc.create({ sku: 'pos-x', category: 'pos_terminal', ...base, status: 'published' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publishes a PARTNER_REDIRECT product when partnerUrl is present', async () => {
    await svc.create({
      sku: 'pos-y',
      category: 'pos_terminal',
      ...base,
      status: 'published',
      partnerRedirect: { partnerUrl: 'https://psp.example' },
    });
    expect(captured.saleMode).toBe('PARTNER_REDIRECT');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', '//evil.example', 'ftp://x'])(
    'rejects publishing a PARTNER_REDIRECT product with a non-http(s) partnerUrl (%s)',
    async (partnerUrl) => {
      await expect(
        svc.create({
          sku: 'pos-z',
          category: 'pos_terminal',
          ...base,
          status: 'published',
          partnerRedirect: { partnerUrl },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});

/**
 * "Teklif Al" → emits a HARDWARE_QUOTE outbox event (consumed by the marketing
 * HardwareQuoteConsumer). The core catalog never writes the leads table. Only
 * QUOTE_ONLY devices use this flow.
 */
describe('CatalogService — requestQuote', () => {
  let prisma: any;
  let outbox: any;
  let svc: CatalogService;

  beforeEach(() => {
    prisma = {
      hardwareProduct: { findUnique: jest.fn() },
      tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme Cafe' }) },
    };
    outbox = { append: jest.fn() };
    svc = new CatalogService(prisma, outbox);
  });

  function row(overrides: any = {}) {
    return {
      id: 'p1',
      sku: 'yk-x',
      name: 'Yazarkasa',
      category: 'yazarkasa',
      status: 'published',
      saleMode: 'QUOTE_ONLY',
      currency: 'TRY',
      inventory: [],
      ...overrides,
    };
  }

  it('rejects a non-quote-only SKU', async () => {
    prisma.hardwareProduct.findUnique.mockResolvedValue(row({ saleMode: 'DIRECT_SALE' }));
    await expect(
      svc.requestQuote('t1', { sku: 'yk-x', contactPerson: 'Ali' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('emits a HARDWARE_QUOTE outbox event with tenant + SKU context + dedup ref (no direct lead write)', async () => {
    prisma.hardwareProduct.findUnique.mockResolvedValue(row());
    const out: any = await svc.requestQuote('t1', { sku: 'yk-x', qty: 2, contactPerson: 'Ali' });
    expect(out.ok).toBe(true);
    // Core never touches the leads table.
    expect((prisma as any).lead).toBeUndefined();
    const ev = outbox.append.mock.calls[0][0];
    expect(ev.type).toBe('marketing.lead.hardware_quote.v1');
    // idempotencyKey == dedup key so retried emits collapse to one row.
    expect(ev.idempotencyKey).toBe('hwq:t1:yk-x');
    expect(ev.tenantId).toBe('t1');
    expect(ev.payload.dedupRef).toBe('hwq:t1:yk-x');
    expect(ev.payload.businessName).toBe('Acme Cafe');
    expect(ev.payload.contactPerson).toBe('Ali');
    expect(ev.payload.notes).toContain('yk-x');
    expect(ev.payload.notes).toContain('× 2');
  });
});
