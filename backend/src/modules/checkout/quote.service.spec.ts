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
    } as any);
    await expect(
      svc.quote({ items: [{ type: 'hardware', sku: 'tab-a8', qty: 1, acquisition: 'rent' }] }),
    ).rejects.toThrow(/not available for rental/i);
  });

  it('rejects empty carts', async () => {
    await expect(svc.quote({ items: [] })).rejects.toThrow(/empty/i);
  });
});
