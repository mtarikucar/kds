import { QuoteService } from './quote.service';
import { CatalogService } from '../catalog/catalog.service';
import { AddOnCatalogService } from '../marketplace/addon-catalog.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

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
    catalog = {
      findBySkuOrThrow: jest.fn(),
      // Task 4 — default to abundant stock so existing hardware-line
      // fixtures below (none of which care about stock) keep passing;
      // the dedicated out-of-stock tests override this per-case.
      getAvailableStock: jest.fn().mockResolvedValue(999),
    } as any;
    addons = { findByCodeOrThrow: jest.fn() } as any;
    svc = new QuoteService(prisma as any, catalog, addons);
  });

  // Plan changes do NOT belong in checkout. A `plan` line used to be priced
  // AND charged, then emit subscription.upgrade.requested.v1 — an event with
  // NO consumer, so the plan never changed: money taken for a no-op. The real
  // plan-change rail is /subscriptions/change-plan → pendingPlanChange →
  // settlement. QuoteService now REJECTS plan lines so nothing can ever charge
  // for a checkout plan no-op. (No UI sends plan lines today; this is latent.)
  it('rejects a plan line (plan changes go through /subscriptions/change-plan)', async () => {
    await expect(
      svc.quote({ items: [{ type: 'plan', code: 'PRO' }] }),
    ).rejects.toThrow(/change-plan/i);
    // Reject up-front — never even look the plan up (no pricing, no charge path).
    expect(prisma.subscriptionPlan.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a mixed cart the moment it hits a plan line', async () => {
    addons.findByCodeOrThrow.mockResolvedValue({
      code: 'kds_extra_screen', name: 'Extra KDS screen', status: 'published',
      billing: 'recurring', priceCents: 5000, currency: 'TRY', id: 'a-1', kind: 'capacity',
    } as any);
    await expect(
      svc.quote({
        items: [
          { type: 'addon', code: 'kds_extra_screen', qty: 2 },
          { type: 'plan', code: 'PRO' },
        ],
      }),
    ).rejects.toThrow(/change-plan/i);
  });

  it('still mixes addon + hardware + service into one quote (no plan)', async () => {
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
        { type: 'addon', code: 'kds_extra_screen', qty: 2 },
        { type: 'hardware', sku: 'kds-21in', qty: 1 },
        { type: 'service', code: 'onsite_install_kds' },
      ],
      shippingAddress: {},
    });

    expect(q.lines).toHaveLength(3);
    // gross lines = 2*5000 + 75000 + 250000 = 335000 (KDV-inclusive).
    // subtotal is NET, total is gross + shipping.
    expect(q.subtotalCents).toBe(279_167); // round(335000 / 1.2)
    expect(q.taxCents).toBe(55_833); // 335000 - 279167
    expect(q.totalCents).toBe(340_000); // 335000 gross + 5000 shipping
    expect(q.shippingCents).toBe(5_000);
    expect(q.isPureRecurring).toBe(false);
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
      expect(q.warnings).toContainEqual(
        expect.objectContaining({ ref: 'yazarkasa-x' }),
      );
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
    expect(q.lines[0].subtotalCents).toBe(50_000); // gross line
    expect(q.subtotalCents).toBe(41_667); // net = round(50000 / 1.2)
    expect(q.totalCents).toBe(55_000); // 50000 gross + 5000 shipping
  });

  // Task 4 — soft display-only warning when the requested qty exceeds real
  // inventory. This does NOT drop the line (the buyer should still see the
  // price/total) and is NOT the enforcement gate — CheckoutIntentService.
  // createIntent is what actually blocks payment (HARDWARE_OUT_OF_STOCK).
  it('still prices a hardware line short on stock but adds a hardware_out_of_stock warning', async () => {
    catalog.findBySkuOrThrow.mockResolvedValue({
      sku: 'printer-80mm', name: 'Printer', status: 'published', category: 'printer',
      priceCents: 50_000, rentalMonthlyCents: null, currency: 'TRY', id: 'h-pr',
      warrantyMonths: 12, saleMode: 'DIRECT_SALE',
    } as any);
    catalog.getAvailableStock.mockResolvedValue(1); // buyer wants 3, only 1 on hand

    const q = await svc.quote({ items: [{ type: 'hardware', sku: 'printer-80mm', qty: 3 }] });

    expect(q.lines).toHaveLength(1); // still priced, not dropped
    expect(q.lines[0].subtotalCents).toBe(150_000);
    expect(q.warnings).toContainEqual({ code: 'hardware_out_of_stock', ref: 'printer-80mm' });
  });

  it('does not warn when stock exactly matches qty', async () => {
    catalog.findBySkuOrThrow.mockResolvedValue({
      sku: 'printer-80mm', name: 'Printer', status: 'published', category: 'printer',
      priceCents: 50_000, rentalMonthlyCents: null, currency: 'TRY', id: 'h-pr',
      warrantyMonths: 12, saleMode: 'DIRECT_SALE',
    } as any);
    catalog.getAvailableStock.mockResolvedValue(2);

    const q = await svc.quote({ items: [{ type: 'hardware', sku: 'printer-80mm', qty: 2 }] });

    expect(q.warnings).toEqual([]);
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
    expect(q.warnings).toContainEqual(
      expect.objectContaining({ ref: 'install-yazarkasa-gib' }),
    );
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
    expect(q.lines[0].subtotalCents).toBe(100_000); // gross line
    expect(q.subtotalCents).toBe(83_333); // net = round(100000 / 1.2)
    expect(q.totalCents).toBe(100_000); // gross (service ≠ hardware → no shipping)
  });

  it('does not double-count KDV: a KDV-inclusive add-on totals the displayed price', async () => {
    addons.findByCodeOrThrow.mockResolvedValue({
      billing: 'recurring',
      priceCents: 49_900,
      currency: 'TRY',
      id: 'a-kdv',
      kind: 'capacity',
      status: 'published',
    } as any);
    const q = await svc.quote({ items: [{ type: 'addon', code: 'kds_extra' }] });
    // ₺499 inclusive → charge ₺499, NOT ₺598.80 (the pre-fix 20%-on-top bug).
    expect(q.totalCents).toBe(49_900);
    expect(q.subtotalCents).toBe(41_583); // round(49900 / 1.2)
    expect(q.taxCents).toBe(8_317); // 49900 - 41583
  });
});
