import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CashDrawerService } from './cash-drawer.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * v2.8.99 — pins the type→approval mapping (CASH_OUT/ADJUSTMENT lands
 * DRAFT, OPENING/CLOSING/CASH_IN auto-APPROVED) and the role gate on
 * approve/reject (ADMIN/MANAGER only).
 */
describe('CashDrawerService', () => {
  let prisma: MockPrismaClient;
  let svc: CashDrawerService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new CashDrawerService(prisma as any);
  });

  for (const autoApproved of ['OPENING', 'CLOSING', 'CASH_IN']) {
    it(`auto-APPROVES on ${autoApproved}`, async () => {
      (prisma.cashDrawerMovement.create as any).mockResolvedValue({ id: 'm-1' });
      await svc.create('t-1', 'u-1', { type: autoApproved as any, amount: 250 });
      const args = (prisma.cashDrawerMovement.create as any).mock.calls[0][0];
      expect(args.data.approvalStatus).toBe('APPROVED');
      expect(args.data.approvedById).toBe('u-1');
      expect(args.data.approvedAt).toBeInstanceOf(Date);
    });
  }

  for (const reviewType of ['CASH_OUT', 'ADJUSTMENT']) {
    it(`lands ${reviewType} as DRAFT awaiting manager approval`, async () => {
      (prisma.cashDrawerMovement.create as any).mockResolvedValue({ id: 'm-2' });
      await svc.create('t-1', 'u-1', { type: reviewType as any, amount: 100 });
      const args = (prisma.cashDrawerMovement.create as any).mock.calls[0][0];
      expect(args.data.approvalStatus).toBe('DRAFT');
      expect(args.data.approvedById).toBeNull();
      expect(args.data.approvedAt).toBeNull();
    });
  }

  it('rejects unknown type with 400', async () => {
    await expect(
      svc.create('t-1', 'u-1', { type: 'XYZ' as any, amount: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approve refuses non-manager roles with 403', async () => {
    await expect(
      svc.approve('t-1', 'm-1', { id: 'u-1', role: UserRole.WAITER as any }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.reject('t-1', 'm-1', { id: 'u-1', role: UserRole.WAITER as any }, { reason: 'no good' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.cashDrawerMovement.updateMany).not.toHaveBeenCalled();
  });

  it('approve flips DRAFT → APPROVED via compound WHERE (tenantId + status=DRAFT)', async () => {
    (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.cashDrawerMovement.findFirstOrThrow as any).mockResolvedValue({
      id: 'm-1', approvalStatus: 'APPROVED',
    });
    await svc.approve('t-1', 'm-1', { id: 'mgr-1', role: UserRole.MANAGER });
    const args = (prisma.cashDrawerMovement.updateMany as any).mock.calls[0][0];
    expect(args.where).toEqual({ id: 'm-1', tenantId: 't-1', approvalStatus: 'DRAFT' });
    expect(args.data.approvalStatus).toBe('APPROVED');
    expect(args.data.approvedById).toBe('mgr-1');
  });

  it('approve surfaces 400 when claim races (count=0)', async () => {
    (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 0 });
    await expect(
      svc.approve('t-1', 'm-1', { id: 'mgr-1', role: UserRole.ADMIN }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reject records rejection reason', async () => {
    (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.cashDrawerMovement.findFirstOrThrow as any).mockResolvedValue({
      id: 'm-1', approvalStatus: 'REJECTED',
    });
    await svc.reject(
      't-1',
      'm-1',
      { id: 'mgr-1', role: UserRole.MANAGER },
      { reason: 'till count did not match' },
    );
    const args = (prisma.cashDrawerMovement.updateMany as any).mock.calls[0][0];
    expect(args.data.approvalStatus).toBe('REJECTED');
    expect(args.data.rejectionReason).toBe('till count did not match');
  });
});
