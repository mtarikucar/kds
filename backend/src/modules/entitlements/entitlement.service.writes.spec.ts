import { EntitlementService } from './entitlement.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';

/**
 * Write-path + query-shape coverage for EntitlementService left untested
 * by entitlement.service.spec (which pins the cache invariants): the exact
 * delete-then-create shape of setGrantsForSourceTx, its empty-grants
 * early-return, sweepExpired's WHERE/return, and the branch-clause shape
 * of getForTenant's findMany (tenant-wide-only vs. branch OR).
 */
describe('EntitlementService — write + query shapes', () => {
  let prisma: MockPrismaClient;
  let svc: EntitlementService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new EntitlementService(prisma as any);
  });

  describe('getForTenant branch clause', () => {
    it('reads only tenant-wide (branchId:null) grants when no branch is given', async () => {
      (prisma.featureEntitlement.findMany as any).mockResolvedValue([]);
      await svc.getForTenant('t1', null);
      const where = (prisma.featureEntitlement.findMany as any).mock.calls[0][0]
        .where;
      expect(where).toEqual({ tenantId: 't1', branchId: null });
    });

    it('reads tenant-wide OR branch-scoped grants when a branch is given', async () => {
      (prisma.featureEntitlement.findMany as any).mockResolvedValue([]);
      await svc.getForTenant('t1', 'b-9');
      const where = (prisma.featureEntitlement.findMany as any).mock.calls[0][0]
        .where;
      expect(where).toEqual({
        tenantId: 't1',
        OR: [{ branchId: null }, { branchId: 'b-9' }],
      });
    });
  });

  describe('setGrantsForSourceTx', () => {
    it('deletes the source rows then bulk-inserts the mapped grants in the tx', async () => {
      const tx = {
        featureEntitlement: {
          deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as any;

      await svc.setGrantsForSourceTx(tx, 't1', 'plan:PRO', [
        {
          scope: 'tenant',
          branchId: null,
          key: 'feature.kds',
          value: true,
          validUntil: null,
        } as any,
      ]);

      expect(tx.featureEntitlement.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 't1', source: 'plan:PRO' },
      });
      const createArg = tx.featureEntitlement.createMany.mock.calls[0][0];
      expect(createArg.data).toEqual([
        {
          tenantId: 't1',
          source: 'plan:PRO',
          scope: 'tenant',
          branchId: null,
          key: 'feature.kds',
          value: true,
          validUntil: null,
        },
      ]);
    });

    it('deletes but does NOT insert when the grant list is empty (pure revoke)', async () => {
      const tx = {
        featureEntitlement: {
          deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
          createMany: jest.fn(),
        },
      } as any;

      await svc.setGrantsForSourceTx(tx, 't1', 'addon:extra', []);

      expect(tx.featureEntitlement.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 't1', source: 'addon:extra' },
      });
      expect(tx.featureEntitlement.createMany).not.toHaveBeenCalled();
    });
  });

  describe('sweepExpired', () => {
    it('deletes rows whose validUntil is in the past and returns the count', async () => {
      (prisma.featureEntitlement.deleteMany as any).mockResolvedValue({
        count: 5,
      });
      const count = await svc.sweepExpired();
      expect(count).toBe(5);
      const where = (prisma.featureEntitlement.deleteMany as any).mock
        .calls[0][0].where;
      expect(where.validUntil.lt).toBeInstanceOf(Date);
    });

    it('clears the read cache so a swept tenant re-reads on next access', async () => {
      (prisma.featureEntitlement.findMany as any).mockResolvedValue([]);
      (prisma.featureEntitlement.deleteMany as any).mockResolvedValue({
        count: 1,
      });

      await svc.getForTenant('t1'); // populate cache (1 read)
      await svc.sweepExpired(); // clears cache
      await svc.getForTenant('t1'); // must re-read (2 reads)

      expect(prisma.featureEntitlement.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
