import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Regression specs for the iter-9 defense-in-depth fixes on
 * SuppliersService (sibling of TablesService, same iter). update + remove
 * switched from id-only update/delete to compound updateMany/deleteMany
 * on (id, tenantId). removeStockItem also pins the
 * `supplier.tenantId` + `stockItem.tenantId` nested-relation predicates
 * — both must belong to the calling tenant for the join row to drop.
 */
describe('SuppliersService (iter-9 compound-WHERE + cross-tenant guards)', () => {
  let prisma: MockPrismaClient;
  let svc: SuppliersService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new SuppliersService(prisma as any);
  });

  describe('update', () => {
    it('writes via compound updateMany on (id, tenantId)', async () => {
      // findOne pre-check resolves.
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1', tenantId: 't1' } as any);
      let updateWhere: any = null;
      (prisma.supplier.updateMany as any).mockImplementation(async ({ where }: any) => {
        updateWhere = where;
        return { count: 1 };
      });
      (prisma.supplier.findFirstOrThrow as any).mockResolvedValue({
        id: 'sup-1', tenantId: 't1', name: 'New',
      } as any);

      await svc.update('sup-1', { name: 'New' } as any, 't1');

      expect(updateWhere).toEqual({ id: 'sup-1', tenantId: 't1' });
    });

    it('throws NotFoundException when updateMany matches no row', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1', tenantId: 't1' } as any);
      (prisma.supplier.updateMany as any).mockResolvedValue({ count: 0 });

      await expect(svc.update('sup-1', { name: 'X' } as any, 't1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('refuses delete when active (non-cancelled, non-received) POs exist', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1', tenantId: 't1' } as any);
      (prisma.purchaseOrder.count as any).mockResolvedValue(2);

      await expect(svc.remove('sup-1', 't1')).rejects.toThrow(BadRequestException);
      // No delete must fire when the PO guard trips.
      expect((prisma.supplier.deleteMany as any).mock.calls.length).toBe(0);
    });

    it('deletes via compound deleteMany on (id, tenantId)', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1', tenantId: 't1' } as any);
      (prisma.purchaseOrder.count as any).mockResolvedValue(0);
      let deleteWhere: any = null;
      (prisma.supplier.deleteMany as any).mockImplementation(async ({ where }: any) => {
        deleteWhere = where;
        return { count: 1 };
      });

      const out = await svc.remove('sup-1', 't1');

      expect(deleteWhere).toEqual({ id: 'sup-1', tenantId: 't1' });
      expect(out).toEqual({ id: 'sup-1' });
    });

    it('deleteMany count=0 surfaces NotFoundException (concurrent-delete race)', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1', tenantId: 't1' } as any);
      (prisma.purchaseOrder.count as any).mockResolvedValue(0);
      (prisma.supplier.deleteMany as any).mockResolvedValue({ count: 0 });

      await expect(svc.remove('sup-1', 't1')).rejects.toThrow(NotFoundException);
    });

    it('refuses delete when AP invoices or expenses reference the supplier (no orphaned financial trail)', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1', tenantId: 't1' } as any);
      (prisma.purchaseOrder.count as any).mockResolvedValue(0);
      (prisma.purchaseInvoice.count as any).mockResolvedValue(3);
      (prisma.expense.count as any).mockResolvedValue(0);

      await expect(svc.remove('sup-1', 't1')).rejects.toThrow(BadRequestException);
      expect((prisma.supplier.deleteMany as any).mock.calls.length).toBe(0);
    });
  });

  describe('removeStockItem', () => {
    it('deletes only when BOTH supplier AND stock item belong to the calling tenant', async () => {
      // findOne pre-check (supplier-side) passes.
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1', tenantId: 't1' } as any);
      let deleteWhere: any = null;
      (prisma.supplierStockItem.deleteMany as any).mockImplementation(async ({ where }: any) => {
        deleteWhere = where;
        return { count: 1 };
      });

      await svc.removeStockItem('sup-1', 'si-1', 't1');

      // Load-bearing — both nested-relation tenant predicates must be
      // in the WHERE so the join row only drops when each side belongs
      // to the calling tenant.
      expect(deleteWhere).toEqual({
        supplierId: 'sup-1',
        stockItemId: 'si-1',
        supplier: { tenantId: 't1' },
        stockItem: { tenantId: 't1' },
      });
    });

    it('throws BadRequestException when the join row does not exist or fails the cross-tenant guard', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-1', tenantId: 't1' } as any);
      (prisma.supplierStockItem.deleteMany as any).mockResolvedValue({ count: 0 });

      await expect(svc.removeStockItem('sup-1', 'si-other', 't1')).rejects.toThrow(BadRequestException);
    });
  });
});
