import { ConflictException, NotFoundException } from '@nestjs/common';
import { StockItemCategoriesService } from './stock-item-categories.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Final iter-9 sibling. Same defense-in-depth treatment as
 * tables (iter-46), suppliers (iter-47), and menu categories (iter-43):
 * update + remove use compound updateMany / deleteMany on (id, tenantId)
 * so the write is independently tenant-scoped from the findOne pre-check.
 *
 * Plus a unique invariant on update(): when the caller passes a new
 * `name`, a separate uniqueness query rejects collisions with EXISTING
 * categories at the same tenant — but excluding the current id via
 * `NOT: { id }`. That NOT clause is load-bearing — without it, a rename
 * to the same name (e.g. trim whitespace) would falsely report a
 * collision.
 */
describe('StockItemCategoriesService (iter-9 + uniqueness guards)', () => {
  let prisma: MockPrismaClient;
  let svc: StockItemCategoriesService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new StockItemCategoriesService(prisma as any);
  });

  describe('create', () => {
    it('rejects duplicate names within the same tenant', async () => {
      prisma.stockItemCategory.findUnique.mockResolvedValue({ id: 'old' } as any);
      await expect(svc.create({ name: 'Produce' } as any, 't1')).rejects.toThrow(ConflictException);
      expect((prisma.stockItemCategory.create as any).mock.calls.length).toBe(0);
    });

    it('creates when no collision exists', async () => {
      prisma.stockItemCategory.findUnique.mockResolvedValue(null);
      (prisma.stockItemCategory.create as any).mockImplementation(async ({ data }: any) => ({
        id: 'new', ...data,
      }));
      const out = await svc.create({ name: 'Produce' } as any, 't1');
      expect(out.id).toBe('new');
      expect(out.tenantId).toBe('t1');
    });
  });

  describe('update', () => {
    it('writes via compound updateMany on (id, tenantId)', async () => {
      // dto without `name` so the service skips the collision-check
      // branch entirely. The compound-WHERE invariant is what this test
      // is pinning, not the uniqueness logic (covered below).
      prisma.stockItemCategory.findFirst.mockResolvedValue({ id: 'cat-1', tenantId: 't1' } as any);
      let updateWhere: any = null;
      (prisma.stockItemCategory.updateMany as any).mockImplementation(async ({ where }: any) => {
        updateWhere = where;
        return { count: 1 };
      });
      (prisma.stockItemCategory.findFirstOrThrow as any).mockResolvedValue({
        id: 'cat-1', tenantId: 't1',
      } as any);

      await svc.update('cat-1', { description: 'Updated description' } as any, 't1');

      expect(updateWhere).toEqual({ id: 'cat-1', tenantId: 't1' });
    });

    it('rejects renames that collide with another category in the same tenant', async () => {
      // findOne (pre-check) — returns the row being updated.
      prisma.stockItemCategory.findFirst
        .mockResolvedValueOnce({ id: 'cat-1', tenantId: 't1' } as any)
        // Name-uniqueness lookup — finds a DIFFERENT row with the same name.
        .mockResolvedValueOnce({ id: 'cat-other' } as any);

      await expect(
        svc.update('cat-1', { name: 'Existing Name' } as any, 't1'),
      ).rejects.toThrow(ConflictException);

      // The collision check fires BEFORE the write, so updateMany must not run.
      expect((prisma.stockItemCategory.updateMany as any).mock.calls.length).toBe(0);
    });

    it('the name-uniqueness query excludes the current row via NOT: { id }', async () => {
      let uniqWhere: any = null;
      (prisma.stockItemCategory.findFirst as any)
        // findOne pre-check
        .mockResolvedValueOnce({ id: 'cat-1', tenantId: 't1' })
        // The collision check — capture the WHERE
        .mockImplementationOnce(({ where }: any) => {
          uniqWhere = where;
          return Promise.resolve(null);
        });
      (prisma.stockItemCategory.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.stockItemCategory.findFirstOrThrow as any).mockResolvedValue({} as any);

      await svc.update('cat-1', { name: 'Same Name' } as any, 't1');

      // Load-bearing: without NOT: { id }, a no-op rename (or whitespace
      // normalization) would self-collide and throw 409.
      expect(uniqWhere).toEqual({ tenantId: 't1', name: 'Same Name', NOT: { id: 'cat-1' } });
    });

    it('skips the name-uniqueness query entirely when dto.name is absent', async () => {
      prisma.stockItemCategory.findFirst.mockResolvedValueOnce({ id: 'cat-1', tenantId: 't1' } as any);
      (prisma.stockItemCategory.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.stockItemCategory.findFirstOrThrow as any).mockResolvedValue({} as any);

      await svc.update('cat-1', { /* no name */ } as any, 't1');

      // Only the findOne pre-check should have happened — no
      // collision-detection query.
      expect((prisma.stockItemCategory.findFirst as any).mock.calls.length).toBe(1);
    });
  });

  describe('remove', () => {
    it('deletes via compound deleteMany on (id, tenantId)', async () => {
      prisma.stockItemCategory.findFirst.mockResolvedValue({ id: 'cat-1', tenantId: 't1' } as any);
      let deleteWhere: any = null;
      (prisma.stockItemCategory.deleteMany as any).mockImplementation(async ({ where }: any) => {
        deleteWhere = where;
        return { count: 1 };
      });

      const out = await svc.remove('cat-1', 't1');

      expect(deleteWhere).toEqual({ id: 'cat-1', tenantId: 't1' });
      expect(out).toEqual({ id: 'cat-1' });
    });

    it('count=0 surfaces NotFoundException (concurrent-delete race)', async () => {
      prisma.stockItemCategory.findFirst.mockResolvedValue({ id: 'cat-1', tenantId: 't1' } as any);
      (prisma.stockItemCategory.deleteMany as any).mockResolvedValue({ count: 0 });
      await expect(svc.remove('cat-1', 't1')).rejects.toThrow(NotFoundException);
    });
  });
});
