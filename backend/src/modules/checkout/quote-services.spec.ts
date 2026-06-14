import { Decimal } from '@prisma/client/runtime/library';
import { QuoteService } from './quote.service';

/**
 * v2.8.87 — DB-driven service pricing in the quote engine.
 *
 * Pre-v2.8.87 services lived in an in-memory `SERVICE_PRICES_CENTS` map.
 * That was acceptable when only 2 codes existed; now the storefront
 * carries ~11 service offerings with rich detail copy, so the catalog
 * (HardwareProduct with category='service') is the source of truth.
 *
 * Behaviour pinned here:
 *   1. A service item resolves via catalog.findBySkuOrThrow.
 *   2. If the row is category!='service' or status!='published', the
 *      line is skipped with a warning (preventing a tenant from "buying"
 *      a hardware SKU as if it were a service).
 *   3. If catalog lookup throws (legacy code with no row), fall back to
 *      the 2 hardcoded legacy entries.
 *   4. cart-line `meta` carries serviceMeta + preferredDates + notes
 *      forward to CheckoutService for InstallationRequest minting.
 */
describe('QuoteService — service pricing via catalog (v2.8.87)', () => {
  let prisma: any;
  let catalog: any;
  let addons: any;
  let svc: QuoteService;

  beforeEach(() => {
    prisma = {
      subscriptionPlan: { findUnique: jest.fn() },
    };
    catalog = { findBySkuOrThrow: jest.fn() };
    addons = { findByCodeOrThrow: jest.fn() };
    svc = new QuoteService(prisma, catalog, addons);
  });

  it('resolves a service via catalog.findBySkuOrThrow and forwards serviceMeta on the priced line', async () => {
    catalog.findBySkuOrThrow.mockResolvedValue({
      sku: 'install-yazarkasa-gib',
      name: 'Yazarkasa kurulum + GİB kaydı',
      status: 'published',
      category: 'service',
      priceCents: 350_000,
      currency: 'TRY',
      serviceMeta: { serviceType: 'onsite', durationHours: 4, requiresBranch: true },
      saleMode: 'DIRECT_SALE',
    });

    const q = await svc.quote({
      items: [
        {
          type: 'service',
          code: 'install-yazarkasa-gib',
          branchId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          preferredDates: ['2026-06-15', '2026-06-18'],
          notes: 'Personel mesai dışı saatlerde ulaşılabilir',
        } as any,
      ],
    });

    expect(q.lines).toHaveLength(1);
    expect(q.lines[0].type).toBe('service');
    expect(q.lines[0].unitCents).toBe(350_000);
    expect(q.lines[0].cadence).toBe('oneTime');
    expect(q.lines[0].meta).toMatchObject({
      branchId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      serviceMeta: { serviceType: 'onsite', durationHours: 4, requiresBranch: true },
      saleMode: 'DIRECT_SALE',
      preferredDates: ['2026-06-15', '2026-06-18'],
      notes: 'Personel mesai dışı saatlerde ulaşılabilir',
    });
  });

  it('rejects a service code that resolves to a hardware row (defence — can\'t "buy" a yazarkasa as a service)', async () => {
    catalog.findBySkuOrThrow.mockResolvedValue({
      sku: 'kds-21in',
      name: '21" KDS',
      status: 'published',
      category: 'kds_screen', // NOT 'service'
      priceCents: 1000,
      currency: 'TRY',
    });

    const q = await svc.quote({
      items: [{ type: 'service', code: 'kds-21in' } as any],
    });

    expect(q.lines).toHaveLength(0);
    expect(q.warnings.some((w) => w.includes('Not purchasable as service'))).toBe(true);
  });

  it('falls back to the legacy in-memory map when the catalog lookup throws (spec stability for old fixtures)', async () => {
    catalog.findBySkuOrThrow.mockRejectedValue(new Error('not found'));

    const q = await svc.quote({
      items: [{ type: 'service', code: 'onsite_install_kds' } as any],
    });

    expect(q.lines).toHaveLength(1);
    expect(q.lines[0].unitCents).toBe(250_000);
    expect(q.lines[0].name).toBe('On-site KDS installation');
  });

  it('warns and skips an unknown service that misses both catalog and legacy', async () => {
    catalog.findBySkuOrThrow.mockRejectedValue(new Error('not found'));
    const q = await svc.quote({
      items: [{ type: 'service', code: 'totally-not-a-service' } as any],
    });
    expect(q.lines).toHaveLength(0);
    expect(q.warnings.some((w) => w.includes('Unknown service'))).toBe(true);
  });

  it('refuses a draft/archived service row (status !== published)', async () => {
    catalog.findBySkuOrThrow.mockResolvedValue({
      sku: 'install-test',
      name: 'Test',
      status: 'draft',
      category: 'service',
      priceCents: 100_000,
      currency: 'TRY',
    });

    const q = await svc.quote({
      items: [{ type: 'service', code: 'install-test' } as any],
    });
    expect(q.lines).toHaveLength(0);
  });

  it('a cart with only services (no hardware) still produces a 0-shipping quote (no carrier dispatch)', async () => {
    catalog.findBySkuOrThrow.mockResolvedValue({
      sku: 'integration-yemeksepeti',
      name: 'Yemeksepeti entegrasyon',
      status: 'published',
      category: 'service',
      priceCents: 250_000,
      currency: 'TRY',
      serviceMeta: { serviceType: 'remote' },
      // v3.0.1 round-4 — service branch is fail-closed on saleMode too.
      saleMode: 'DIRECT_SALE',
    });

    const q = await svc.quote({
      items: [{ type: 'service', code: 'integration-yemeksepeti' } as any],
    });
    expect(q.lines).toHaveLength(1);
    expect(q.shippingCents).toBe(0);
  });
});
