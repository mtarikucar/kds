import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CashDrawerService } from './cash-drawer.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * Covers the cash-drawer paths the main spec leaves untested:
 *   - findOne: branch-scoped lookup + 404 when out of scope / missing,
 *   - reject: the race-loss 400 when the row is no longer DRAFT.
 */
describe('CashDrawerService — findOne + reject race', () => {
  let prisma: MockPrismaClient;
  let svc: CashDrawerService;

  const scope = {
    tenantId: 't-1',
    branchId: 'b-1',
    userId: 'u-1',
    role: UserRole.MANAGER,
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new CashDrawerService(prisma as any);
  });

  describe('findOne', () => {
    it('scopes the lookup by (id + branchScope) and returns the row with its audit relations', async () => {
      const row = { id: 'm-1', user: {}, approvedBy: null };
      (prisma.cashDrawerMovement.findFirst as any).mockResolvedValue(row);

      const result = await svc.findOne(scope, 'm-1');

      expect(result).toBe(row);
      const args = (prisma.cashDrawerMovement.findFirst as any).mock.calls[0][0];
      expect(args.where).toEqual({
        id: 'm-1',
        tenantId: 't-1',
        branchId: 'b-1',
      });
      // pulls the actor + approver for the audit trail panel
      expect(args.include.user).toBeDefined();
      expect(args.include.approvedBy).toBeDefined();
    });

    it('throws NotFound when no row matches the branch scope', async () => {
      (prisma.cashDrawerMovement.findFirst as any).mockResolvedValue(null);
      await expect(svc.findOne(scope, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('reject', () => {
    it('surfaces 400 when the claim loses the race (row no longer DRAFT)', async () => {
      (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({
        count: 0,
      });
      await expect(
        svc.reject(
          scope,
          'm-1',
          { id: 'mgr-1', role: UserRole.MANAGER },
          { reason: 'too late' },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // No post-claim read / audit when the claim lost.
      expect(prisma.cashDrawerMovement.findFirstOrThrow).not.toHaveBeenCalled();
    });

    it('writes the rejection reason into the compound-scoped updateMany on a winning claim', async () => {
      (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({
        count: 1,
      });
      (prisma.cashDrawerMovement.findFirstOrThrow as any).mockResolvedValue({
        id: 'm-1',
        type: 'CASH_OUT',
        amount: { toString: () => '100' },
      });
      (prisma.userActivity.create as any).mockResolvedValue({});

      await svc.reject(
        scope,
        'm-1',
        { id: 'mgr-1', role: UserRole.MANAGER },
        { reason: 'miscount' },
      );

      const args = (prisma.cashDrawerMovement.updateMany as any).mock
        .calls[0][0];
      expect(args.where).toEqual({
        id: 'm-1',
        tenantId: 't-1',
        branchId: 'b-1',
        approvalStatus: 'DRAFT',
      });
      expect(args.data.approvalStatus).toBe('REJECTED');
      expect(args.data.rejectionReason).toBe('miscount');
      expect(args.data.approvedById).toBe('mgr-1');
    });
  });
});
