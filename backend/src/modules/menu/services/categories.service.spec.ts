import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CategoriesService } from './categories.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Targeted regression specs for two defense-in-depth invariants:
 *
 *   - iter-33: update()'s post-write read must keep the compound WHERE
 *     (id, tenantId). A future refactor that drops the tenant filter
 *     and re-keys on id alone would silently expose cross-tenant data
 *     to the caller.
 *
 *   - iter-11: remove() must run the count + delete inside a
 *     SERIALIZABLE transaction (Product → Category FK is onDelete:
 *     Cascade). Without this, a product inserted between the count
 *     check and the delete gets silently cascaded away.
 */
describe('CategoriesService', () => {
  let prisma: MockPrismaClient;
  let svc: CategoriesService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new CategoriesService(prisma as any);
  });

  // -- iter-33: update() post-write read uses compound WHERE -----------

  describe('update', () => {
    it('returns the row via findFirstOrThrow with compound (id, tenantId) WHERE', async () => {
      // findOne pre-check passes.
      prisma.category.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 't1' } as any);
      (prisma.category.updateMany as any).mockResolvedValue({ count: 1 });

      let readWhere: any = null;
      (prisma.category.findFirstOrThrow as any).mockImplementation(async ({ where }: any) => {
        readWhere = where;
        return { id: 'c-1', tenantId: 't1', name: 'Renamed' };
      });

      const out = await svc.update('c-1', { name: 'Renamed' } as any, 't1');

      // The load-bearing assertion: tenant scope must be in the read's
      // WHERE clause, not just in the preceding updateMany.
      expect(readWhere).toEqual({ id: 'c-1', tenantId: 't1' });
      expect(out.id).toBe('c-1');
    });

    it('throws ConflictException when the updateMany matches no rows', async () => {
      prisma.category.findFirst.mockResolvedValue({ id: 'c-1', tenantId: 't1' } as any);
      (prisma.category.updateMany as any).mockResolvedValue({ count: 0 });

      await expect(svc.update('c-1', { name: 'X' } as any, 't1')).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException from the pre-check when the row does not exist', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      await expect(svc.update('nope', { name: 'X' } as any, 't1')).rejects.toThrow(NotFoundException);
    });
  });

  // -- iter-11: remove() uses SERIALIZABLE tx + count guard ------------

  describe('remove', () => {
    // The tx mock forwards the inner work onto the real `prisma` mock,
    // which is what the test asserts against. Most importantly, it
    // captures the isolation level argument so we can pin the
    // SERIALIZABLE invariant.
    let txIsolation: Prisma.TransactionIsolationLevel | undefined;

    beforeEach(() => {
      txIsolation = undefined;
      (prisma.$transaction as any).mockImplementation(async (work: any, opts: any) => {
        txIsolation = opts?.isolationLevel;
        return await work(prisma);
      });
    });

    it('runs the count + delete inside a SERIALIZABLE transaction', async () => {
      prisma.category.findFirst.mockResolvedValue({
        id: 'c-1',
        tenantId: 't1',
        _count: { products: 0 },
      } as any);
      (prisma.category.delete as any).mockResolvedValue({ id: 'c-1' });

      await svc.remove('c-1', 't1');

      // Load-bearing: anything weaker than SERIALIZABLE re-opens the
      // cascade-during-delete race iter-11 was meant to close.
      expect(txIsolation).toBe(Prisma.TransactionIsolationLevel.Serializable);
    });

    it('refuses to delete when any product still references the category', async () => {
      prisma.category.findFirst.mockResolvedValue({
        id: 'c-1',
        tenantId: 't1',
        _count: { products: 3 },
      } as any);

      await expect(svc.remove('c-1', 't1')).rejects.toThrow(ConflictException);
      // The delete must not run when the count guard trips.
      expect((prisma.category.delete as any).mock.calls.length).toBe(0);
    });

    it('translates Postgres SERIALIZATION_FAILURE (P2034) into a 409', async () => {
      const err = new Prisma.PrismaClientKnownRequestError('serialize fail', {
        code: 'P2034',
        clientVersion: 'test',
      });
      (prisma.$transaction as any).mockRejectedValue(err);

      await expect(svc.remove('c-1', 't1')).rejects.toThrow(ConflictException);
    });

    it('lets non-P2034 errors propagate unchanged', async () => {
      const err = new Error('unexpected');
      (prisma.$transaction as any).mockRejectedValue(err);

      await expect(svc.remove('c-1', 't1')).rejects.toThrow('unexpected');
    });
  });
});
