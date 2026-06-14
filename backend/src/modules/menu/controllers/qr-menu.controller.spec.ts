import { NotFoundException } from '@nestjs/common';
import { QrMenuController } from './qr-menu.controller';

/**
 * Spec for the @Public QrMenuController. The real logic lives in the boundary
 * branches:
 *  - by-subdomain only resolves ACTIVE tenants (suspended → 404, no leak)
 *  - by-tenantId 404s on a missing/inactive tenant
 *  - QR settings are read side-effect-free and null-coalesced to defaults
 *  - Decimal prices/modifier adjustments are coerced to Number for JSON
 */
function makePrisma(overrides: Record<string, any> = {}) {
  return {
    tenant: { findFirst: jest.fn() },
    qrMenuSettings: { findFirst: jest.fn().mockResolvedValue(null) },
    table: { findFirst: jest.fn().mockResolvedValue(null) },
    category: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

const posSettings = {
  findByTenant: jest.fn().mockResolvedValue({
    enableCustomerOrdering: true,
    enableTablelessMode: false,
    enableCustomerSelfPay: 1,
  }),
};

describe('QrMenuController', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('getPublicMenuBySubdomain', () => {
    it('404s when no ACTIVE tenant matches the subdomain (suspended-tenant leak guard)', async () => {
      const prisma = makePrisma();
      prisma.tenant.findFirst.mockResolvedValueOnce(null);
      const ctrl = new QrMenuController(prisma as any, posSettings as any);
      await expect(ctrl.getPublicMenuBySubdomain('acme')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // queried with the ACTIVE status filter
      expect(prisma.tenant.findFirst).toHaveBeenCalledWith({
        where: { subdomain: 'acme', status: 'ACTIVE' },
      });
    });

    it('delegates to getPublicMenu with the resolved tenant id', async () => {
      const prisma = makePrisma();
      prisma.tenant.findFirst
        .mockResolvedValueOnce({ id: 'tenant-9' }) // by-subdomain lookup
        .mockResolvedValueOnce({ id: 'tenant-9', name: 'Acme' }); // getPublicMenu lookup
      const ctrl = new QrMenuController(prisma as any, posSettings as any);
      const res = await ctrl.getPublicMenuBySubdomain('acme', 'table-1');
      expect(res.tenant.id).toBe('tenant-9');
    });
  });

  describe('getPublicMenu', () => {
    it('404s when the tenant is missing/inactive', async () => {
      const prisma = makePrisma();
      prisma.tenant.findFirst.mockResolvedValueOnce(null);
      const ctrl = new QrMenuController(prisma as any, posSettings as any);
      await expect(ctrl.getPublicMenu('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('null-coalesces missing QR settings to defaults', async () => {
      const prisma = makePrisma();
      prisma.tenant.findFirst.mockResolvedValueOnce({ id: 't1', name: 'Acme' });
      const ctrl = new QrMenuController(prisma as any, posSettings as any);
      const res = await ctrl.getPublicMenu('t1');
      expect(res.settings.primaryColor).toBe('#3B82F6');
      expect(res.settings.layoutStyle).toBe('GRID');
      expect(res.settings.itemsPerRow).toBe(2);
      expect(res.settings.showPrices).toBe(true);
    });

    it('coerces enableCustomerSelfPay (truthy number) to a boolean', async () => {
      const prisma = makePrisma();
      prisma.tenant.findFirst.mockResolvedValueOnce({ id: 't1', name: 'Acme' });
      const ctrl = new QrMenuController(prisma as any, posSettings as any);
      const res = await ctrl.getPublicMenu('t1');
      expect(res.enableCustomerSelfPay).toBe(true);
    });

    it('converts Decimal product prices + modifier adjustments to numbers', async () => {
      const prisma = makePrisma();
      prisma.tenant.findFirst.mockResolvedValueOnce({ id: 't1', name: 'Acme' });
      prisma.category.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          products: [
            {
              id: 'p1',
              name: 'Pizza',
              description: null,
              price: { toString: () => '12.50' }, // Decimal-like; Number() coerces
              image: null,
              categoryId: 'c1',
              productImages: [],
              modifierGroups: [
                {
                  displayOrder: 0,
                  group: {
                    id: 'g1',
                    modifiers: [{ id: 'm1', priceAdjustment: { toString: () => '2.00' } }],
                  },
                },
              ],
            },
          ],
        },
      ]);
      const ctrl = new QrMenuController(prisma as any, posSettings as any);
      const res = await ctrl.getPublicMenu('t1');
      const product = res.categories[0].products[0];
      expect(typeof product.price).toBe('number');
      expect(product.price).toBe(12.5);
      expect(typeof product.modifierGroups[0].modifiers[0].priceAdjustment).toBe('number');
      expect(product.modifierGroups[0].modifiers[0].priceAdjustment).toBe(2);
    });

    it('looks up the table only when a tableId is supplied', async () => {
      const prisma = makePrisma();
      prisma.tenant.findFirst.mockResolvedValue({ id: 't1', name: 'Acme' });
      const ctrl = new QrMenuController(prisma as any, posSettings as any);

      await ctrl.getPublicMenu('t1');
      expect(prisma.table.findFirst).not.toHaveBeenCalled();

      await ctrl.getPublicMenu('t1', 'table-7');
      expect(prisma.table.findFirst).toHaveBeenCalledWith({
        where: { id: 'table-7', tenantId: 't1' },
      });
    });
  });
});
