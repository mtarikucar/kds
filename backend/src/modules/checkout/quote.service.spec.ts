import { QuoteService } from './quote.service';
import { CatalogService } from '../catalog/catalog.service';
import { AddOnCatalogService } from '../marketplace/addon-catalog.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * QuoteService is the pricing seam every cart goes through. These tests
 * pin down the rules that customers and finance care about most:
 *   - mixed cart totals
 *   - billing cycle for plans
 *   - unknown codes become soft warnings, not 500s
 *   - hardware out-of-stock / unpublished is rejected
 *   - rental requires a rental price
 *   - tax + shipping math is consistent with subtotal
 */
describe('QuoteService', () => {
  let prisma: MockPrismaClient;
  let catalog: jest.Mocked<CatalogService>;
  let addons: jest.Mocked<AddOnCatalogService>;
  let svc: QuoteService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    catalog = { findBySkuOrThrow: jest.fn() } as any;
    addons = { findByCodeOrThrow: jest.fn() } as any;
    svc = new QuoteService(prisma as any, catalog, addons);
  });

  it('prices a PRO plan at the monthly rate by default', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'p-pro',
      name: 'PRO',
      displayName: 'Profesyonel',
      monthlyPrice: new Decimal('1299'),
      yearlyPrice: new Decimal('12990'),
      currency: 'TRY',
    } as any);

    const q = await svc.quote({ items: [{ type: 'plan', code: 'PRO' }] });

    expect(q.lines).toHaveLength(1);
    expect(q.lines[0].subtotalCents).toBe(129900);
    expect(q.lines[0].cadence).toBe('monthly');
    expect(q.subtotalCents).toBe(129900);
    expect(q.taxCents).toBe(Math.round(129900 * 0.2));
    expect(q.shippingCents).toBe(0);   // no hardware
    expect(q.isPureRecurring).toBe(true);
  });

  it('switches to yearly price when billingCycle is YEARLY', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'p-pro',
      name: 'PRO',
      displayName: 'Profesyonel',
      monthlyPrice: new Decimal('1299'),
      yearlyPrice: new Decimal('12990'),
      currency: 'TRY',
    } as any);
    const q = await svc.quote({ items: [{ type: 'plan', code: 'PRO', billingCycle: 'YEARLY' }] });
    expect(q.lines[0].subtotalCents).toBe(1_299_000);
    expect(q.lines[0].cadence).toBe('yearly');
  });

  it('mixes plan + addon + hardware + service into one quote', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 'p-pro', name: 'PRO', displayName: 'Pro', monthlyPrice: new Decimal('1000'),
      yearlyPrice: new Decimal('10000'), currency: 'TRY',
    } as any);
    addons.findByCodeOrThrow.mockResolvedValue({
      code: 'kds_extra_screen', name: 'Extra KDS screen', status: 'published',
      billing: 'recurring', priceCents: 5000, currency: 'TRY', id: 'a-1', kind: 'capacity',
    } as any);
    // v2.8.87: catalog.findBySkuOrThrow is now hit for BOTH hardware and
    // service items (services live as HardwareProduct rows with
    // category='service'). Mock by-SKU so each path resolves correctly.
    // 'onsite_install_kds' is a LEGACY service code that no longer has a
    // catalog row — the implementation falls back to the in-memory map
    // for spec stability, so the mock throws for that SKU.
    catalog.findBySkuOrThrow.mockImplementation(async (sku: string) => {
      if (sku === 'kds-21in') {
        return {
          sku: 'kds-21in', name: '21" KDS Screen', status: 'published', category: 'kds_screen',
          priceCents: 75000, rentalMonthlyCents: null, currency: 'TRY', id: 'h-1', warrantyMonths: 12,
          // v3.0.1 round-4 — guard is now fail-closed (`!== "DIRECT_SALE"`)
          // so fixtures must explicitly mark sellable rows.
          saleMode: 'DIRECT_SALE',
        } as any;
      }
      throw new Error(`SKU not in fixture: ${sku}`);
    });

    const q = await svc.quote({
      items: [
        { type: 'plan', code: 'PRO' },
        { type: 'addon', code: 'kds_extra_screen', qty: 2 },
        { type: 'hardware', sku: 'kds-21in', qty: 1 },
        { type: 'service', code: 'onsite_install_kds' },
      ],
      shippingAddress: {},
    });

    expect(q.lines).toHaveLength(4);
    // subtotal = 100000 + 2*5000 + 75000 + 250000 = 435000
    expect(q.subtotalCents).toBe(435_000);
    expect(q.shippingCents).toBe(5_000);
    expect(q.isPureRecurring).toBe(false);
  });

  it('emits a warning instead of failing when a plan code is unknown', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(null);
    const q = await svc.quote({ items: [{ type: 'plan', code: 'NOPE' }] });
    expect(q.lines).toHaveLength(0);
    expect(q.warnings).toContainEqual(expect.stringContaining('NOPE'));
  });

  it('refuses to price a rental for SKUs without a rental price', async () => {
    catalog.findBySkuOrThrow.mockResolvedValue({
      sku: 'tab-a8', name: 'Tablet', status: 'published',
      priceCents: 10000, rentalMonthlyCents: null, currency: 'TRY', id: 'h-9', warrantyMonths: 12,
      // v3.0.1 round-4 — fail-closed saleMode guard requires this.
      saleMode: 'DIRECT_SALE',
    } as any);
    await expect(
      svc.quote({ items: [{ type: 'hardware', sku: 'tab-a8', qty: 1, acquisition: 'rent' }] }),
    ).rejects.toThrow(/not available for rental/i);
  });

  it('rejects empty carts', async () => {
    await expect(svc.quote({ items: [] })).rejects.toThrow(/empty/i);
  });

  // Regulatory tier guard (TR law): only DIRECT_SALE hardware may be priced.
  // QUOTE_ONLY (yazarkasa), PARTNER_REDIRECT (bank POS) and RECOMMENDED_ONLY
  // (uncertified scale) are dropped to a warning even if a tampered client
  // adds them — proving a regulated device can never reach payment.
  it.each(['QUOTE_ONLY', 'PARTNER_REDIRECT', 'RECOMMENDED_ONLY'])(
    'drops a %s hardware SKU from the quote (no priced line, soft warning)',
    async (saleMode) => {
      catalog.findBySkuOrThrow.mockResolvedValue({
        sku: 'yazarkasa-x', name: 'Yazarkasa', status: 'published', category: 'yazarkasa',
        priceCents: 1_299_900, rentalMonthlyCents: null, currency: 'TRY', id: 'h-yk',
        warrantyMonths: 24, saleMode,
      } as any);
      const q = await svc.quote({ items: [{ type: 'hardware', sku: 'yazarkasa-x', qty: 1 }] });
      expect(q.lines).toHaveLength(0);
      expect(q.warnings).toContainEqual(expect.stringContaining('yazarkasa-x'));
      expect(q.subtotalCents).toBe(0);
    },
  );

  it('still prices a DIRECT_SALE hardware SKU normally', async () => {
    catalog.findBySkuOrThrow.mockResolvedValue({
      sku: 'printer-80mm', name: 'Printer', status: 'published', category: 'printer',
      priceCents: 50_000, rentalMonthlyCents: null, currency: 'TRY', id: 'h-pr',
      warrantyMonths: 12, saleMode: 'DIRECT_SALE',
    } as any);
    const q = await svc.quote({ items: [{ type: 'hardware', sku: 'printer-80mm', qty: 1 }] });
    expect(q.lines).toHaveLength(1);
    expect(q.subtotalCents).toBe(50_000);
  });

  // The service branch carries the same regulatory gate: a non-DIRECT_SALE
  // service row (e.g. a fiscal-install / GİB-activation offering tagged
  // QUOTE_ONLY) must be dropped, never priced/provisioned.
  it('drops a non-DIRECT_SALE service SKU from the quote', async () => {
    catalog.findBySkuOrThrow.mockResolvedValue({
      sku: 'install-yazarkasa-gib', name: 'Yazarkasa kurulum', status: 'published',
      category: 'service', priceCents: 100_000, currency: 'TRY', id: 's-1',
      serviceMeta: { serviceType: 'onsite' }, saleMode: 'QUOTE_ONLY',
    } as any);
    const q = await svc.quote({ items: [{ type: 'service', code: 'install-yazarkasa-gib' }] });
    expect(q.lines).toHaveLength(0);
    expect(q.warnings).toContainEqual(expect.stringContaining('install-yazarkasa-gib'));
    expect(q.subtotalCents).toBe(0);
  });

  it('still prices a DIRECT_SALE service SKU normally', async () => {
    catalog.findBySkuOrThrow.mockResolvedValue({
      sku: 'install-kds', name: 'KDS kurulum', status: 'published', category: 'service',
      priceCents: 100_000, currency: 'TRY', id: 's-2',
      serviceMeta: { serviceType: 'onsite' }, saleMode: 'DIRECT_SALE',
    } as any);
    const q = await svc.quote({ items: [{ type: 'service', code: 'install-kds' }] });
    expect(q.lines).toHaveLength(1);
    expect(q.subtotalCents).toBe(100_000);
  });
});
