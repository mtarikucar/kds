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
    svc = new CatalogService(prisma);
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
 * "Teklif Al" → marketing Lead (source=HARDWARE_QUOTE). Only QUOTE_ONLY
 * devices use this flow; everything else is bought directly, redirected, or
 * recommended-only.
 */
describe('CatalogService — requestQuote', () => {
  let prisma: any;
  let svc: CatalogService;

  beforeEach(() => {
    prisma = {
      hardwareProduct: { findUnique: jest.fn() },
      tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme Cafe' }) },
      lead: {
        // requestQuote upserts on a deterministic externalRef for idempotency.
        upsert: jest.fn(async ({ create }: any) => ({ id: 'l1', status: 'NEW', ...create })),
      },
    };
    svc = new CatalogService(prisma);
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
    expect(prisma.lead.upsert).not.toHaveBeenCalled();
  });

  it('upserts a HARDWARE_QUOTE lead for a quote-only SKU with tenant + SKU context + dedup ref', async () => {
    prisma.hardwareProduct.findUnique.mockResolvedValue(row());
    const out: any = await svc.requestQuote('t1', { sku: 'yk-x', qty: 2, contactPerson: 'Ali' });
    expect(out.ok).toBe(true);
    const arg = prisma.lead.upsert.mock.calls[0][0];
    // Deterministic dedup key so resubmits collapse into one lead.
    expect(arg.where.externalRef).toBe('hwq:t1:yk-x');
    expect(arg.create.source).toBe('HARDWARE_QUOTE');
    expect(arg.create.businessName).toBe('Acme Cafe');
    expect(arg.create.contactPerson).toBe('Ali');
    expect(arg.create.externalRef).toBe('hwq:t1:yk-x');
    expect(arg.create.notes).toContain('yk-x');
    expect(arg.create.notes).toContain('× 2');
  });
});
