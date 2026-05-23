import { TenantMarketplaceService } from './tenant-marketplace.service';
import { AddOnCatalogService } from './addon-catalog.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Tenant-side marketplace purchase paths. The dependency-check matrix is
 * the security-relevant part — a tenant must not be able to buy something
 * whose entitlements would clash with a missing prerequisite.
 */
describe('TenantMarketplaceService.purchase', () => {
  let prisma: MockPrismaClient;
  let catalog: jest.Mocked<AddOnCatalogService>;
  let outbox: { append: jest.Mock };
  let svc: TenantMarketplaceService;

  const TENANT = 't1';

  beforeEach(() => {
    prisma = mockPrismaClient();
    catalog = { findByCodeOrThrow: jest.fn() } as any;
    outbox = { append: jest.fn().mockResolvedValue('ok') };
    svc = new TenantMarketplaceService(prisma as any, catalog, outbox as any);
  });

  it('rejects purchase of draft or archived add-ons', async () => {
    catalog.findByCodeOrThrow.mockResolvedValueOnce({ id: 'a-1', code: 'x', status: 'draft', deps: [], billing: 'recurring' } as any);
    await expect(svc.purchase(TENANT, { addOnCode: 'x' })).rejects.toThrow(/not yet published/);

    catalog.findByCodeOrThrow.mockResolvedValueOnce({ id: 'a-2', code: 'x', status: 'archived', deps: [], billing: 'recurring' } as any);
    await expect(svc.purchase(TENANT, { addOnCode: 'x' })).rejects.toThrow(/no longer available/);
  });

  it('rejects when a plan dep is unmet', async () => {
    catalog.findByCodeOrThrow.mockResolvedValue({
      id: 'a-3', code: 'fiscal_hugin', status: 'published', deps: ['plan:PRO'], billing: 'recurring',
    } as any);
    prisma.tenant.findUnique.mockResolvedValue({ id: TENANT, currentPlan: { name: 'BASIC' } } as any);
    prisma.tenantAddOn.findMany.mockResolvedValue([]);

    await expect(svc.purchase(TENANT, { addOnCode: 'fiscal_hugin' })).rejects.toThrow(/requires.*plan:PRO/i);
  });

  it('rejects when an addon dep is unmet', async () => {
    catalog.findByCodeOrThrow.mockResolvedValue({
      id: 'a-4', code: 'delivery_yemeksepeti', status: 'published', deps: ['delivery_hub'], billing: 'recurring',
    } as any);
    prisma.tenant.findUnique.mockResolvedValue({ id: TENANT, currentPlan: { name: 'PRO' } } as any);
    prisma.tenantAddOn.findMany.mockResolvedValue([] as any);

    await expect(svc.purchase(TENANT, { addOnCode: 'delivery_yemeksepeti' })).rejects.toThrow(/delivery_hub/);
  });

  it('purchases happily when deps are met and emits AddOnPurchased', async () => {
    catalog.findByCodeOrThrow.mockResolvedValue({
      id: 'a-5', code: 'kds_extra_screen', status: 'published', deps: [], billing: 'recurring',
    } as any);
    (prisma.tenantAddOn.create as any).mockImplementation(async ({ data }: any) => ({ id: 't-a-1', ...data }));

    const out = await svc.purchase(TENANT, { addOnCode: 'kds_extra_screen', quantity: 3 });
    expect(out.quantity).toBe(3);
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'addon.purchased.v1' }),
    );
  });
});
