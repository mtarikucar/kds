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

  const scope = { tenantId: 't-1', branchId: 'b-1', userId: 'u-1', role: UserRole.MANAGER } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new CashDrawerService(prisma as any);
  });

  for (const autoApproved of ['OPENING', 'CLOSING', 'CASH_IN']) {
    it(`auto-APPROVES on ${autoApproved}`, async () => {
      (prisma.cashDrawerMovement.create as any).mockResolvedValue({ id: 'm-1' });
      await svc.create('t-1', 'b-1', 'u-1', { type: autoApproved as any, amount: 250 });
      const args = (prisma.cashDrawerMovement.create as any).mock.calls[0][0];
      expect(args.data.approvalStatus).toBe('APPROVED');
      expect(args.data.approvedById).toBe('u-1');
      expect(args.data.approvedAt).toBeInstanceOf(Date);
    });
  }

  for (const reviewType of ['CASH_OUT', 'ADJUSTMENT']) {
    it(`lands ${reviewType} as DRAFT awaiting manager approval`, async () => {
      (prisma.cashDrawerMovement.create as any).mockResolvedValue({ id: 'm-2' });
      await svc.create('t-1', 'b-1', 'u-1', { type: reviewType as any, amount: 100 });
      const args = (prisma.cashDrawerMovement.create as any).mock.calls[0][0];
      expect(args.data.approvalStatus).toBe('DRAFT');
      expect(args.data.approvedById).toBeNull();
      expect(args.data.approvedAt).toBeNull();
    });
  }

  it('rejects unknown type with 400', async () => {
    await expect(
      svc.create('t-1', 'b-1', 'u-1', { type: 'XYZ' as any, amount: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── Honesty (fake-working sweep #3): denominationBreakdown must sum to
  //    the entered amount, otherwise the till count silently disagrees with
  //    the figure it claims to back. No breakdown → no check (field stays
  //    optional). ───────────────────────────────────────────────────────
  describe('denominationBreakdown sum invariant', () => {
    it('persists a CLOSING whose denomination count sums to the amount', async () => {
      (prisma.cashDrawerMovement.create as any).mockResolvedValue({ id: 'm-1' });
      // 5×100 + 10×50 + 15×20 = 500 + 500 + 300 = 1300
      await svc.create('t-1', 'b-1', 'u-1', {
        type: 'CLOSING' as any,
        amount: 1300,
        denominationBreakdown: { '100': 5, '50': 10, '20': 15 },
      });
      const args = (prisma.cashDrawerMovement.create as any).mock.calls[0][0];
      expect(args.data.denominationBreakdown).toEqual({ '100': 5, '50': 10, '20': 15 });
    });

    it('rejects a denomination count that does NOT sum to the amount', async () => {
      // 5×100 + 10×50 = 1000, but amount claims 1300 → mismatch.
      await expect(
        svc.create('t-1', 'b-1', 'u-1', {
          type: 'CLOSING' as any,
          amount: 1300,
          denominationBreakdown: { '100': 5, '50': 10 },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.cashDrawerMovement.create).not.toHaveBeenCalled();
    });

    it('accepts fractional face values (coins) that sum correctly', async () => {
      (prisma.cashDrawerMovement.create as any).mockResolvedValue({ id: 'm-1' });
      // 0.25×4 + 1×3 = 1 + 3 = 4.00 — float drift must not trip the check.
      await svc.create('t-1', 'b-1', 'u-1', {
        type: 'CLOSING' as any,
        amount: 4,
        denominationBreakdown: { '0.25': 4, '1': 3 },
      });
      expect(prisma.cashDrawerMovement.create).toHaveBeenCalled();
    });

    it('rejects a negative count', async () => {
      await expect(
        svc.create('t-1', 'b-1', 'u-1', {
          type: 'CLOSING' as any,
          amount: 100,
          denominationBreakdown: { '100': -1 } as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a fractional count even when it happens to sum to the amount', async () => {
      // 2.5 × 100 = 250 sums correctly, but "2.5 notes" is physically
      // impossible — a fat-fingered "2.5" for "25" must not slip through.
      await expect(
        svc.create('t-1', 'b-1', 'u-1', {
          type: 'CLOSING' as any,
          amount: 250,
          denominationBreakdown: { '100': 2.5 } as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a non-numeric face value', async () => {
      await expect(
        svc.create('t-1', 'b-1', 'u-1', {
          type: 'CLOSING' as any,
          amount: 100,
          denominationBreakdown: { abc: 1 } as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('skips the check entirely when no breakdown is supplied', async () => {
      (prisma.cashDrawerMovement.create as any).mockResolvedValue({ id: 'm-1' });
      await svc.create('t-1', 'b-1', 'u-1', { type: 'CLOSING' as any, amount: 999 });
      expect(prisma.cashDrawerMovement.create).toHaveBeenCalled();
    });

    it('treats an empty breakdown map as "not supplied" (no check)', async () => {
      (prisma.cashDrawerMovement.create as any).mockResolvedValue({ id: 'm-1' });
      await svc.create('t-1', 'b-1', 'u-1', {
        type: 'CLOSING' as any,
        amount: 999,
        denominationBreakdown: {},
      });
      expect(prisma.cashDrawerMovement.create).toHaveBeenCalled();
    });
  });

  it('approve refuses non-manager roles with 403', async () => {
    await expect(
      svc.approve(scope, 'm-1', { id: 'u-1', role: UserRole.WAITER as any }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      svc.reject(scope, 'm-1', { id: 'u-1', role: UserRole.WAITER as any }, { reason: 'no good' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.cashDrawerMovement.updateMany).not.toHaveBeenCalled();
  });

  it('approve flips DRAFT → APPROVED via compound WHERE (tenantId + branchId + status=DRAFT)', async () => {
    (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.cashDrawerMovement.findFirstOrThrow as any).mockResolvedValue({
      id: 'm-1', approvalStatus: 'APPROVED', type: 'CASH_OUT', amount: { toString: () => '100' },
    });
    await svc.approve(scope, 'm-1', { id: 'mgr-1', role: UserRole.MANAGER });
    const args = (prisma.cashDrawerMovement.updateMany as any).mock.calls[0][0];
    expect(args.where).toEqual({ id: 'm-1', tenantId: 't-1', branchId: 'b-1', approvalStatus: 'DRAFT' });
    expect(args.data.approvalStatus).toBe('APPROVED');
    expect(args.data.approvedById).toBe('mgr-1');
  });

  it('approve surfaces 400 when claim races (count=0)', async () => {
    (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 0 });
    await expect(
      svc.approve(scope, 'm-1', { id: 'mgr-1', role: UserRole.ADMIN }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reject records rejection reason', async () => {
    (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.cashDrawerMovement.findFirstOrThrow as any).mockResolvedValue({
      id: 'm-1', approvalStatus: 'REJECTED', type: 'ADJUSTMENT', amount: { toString: () => '50' },
    });
    await svc.reject(
      scope,
      'm-1',
      { id: 'mgr-1', role: UserRole.MANAGER },
      { reason: 'till count did not match' },
    );
    const args = (prisma.cashDrawerMovement.updateMany as any).mock.calls[0][0];
    expect(args.data.approvalStatus).toBe('REJECTED');
    expect(args.data.rejectionReason).toBe('till count did not match');
  });

  it('listPending scopes by branchId (no cross-branch leak)', async () => {
    (prisma.cashDrawerMovement.findMany as any).mockResolvedValue([]);
    await svc.listPending(scope);
    const where = (prisma.cashDrawerMovement.findMany as any).mock.calls[0][0].where;
    expect(where.branchId).toBe('b-1');
    expect(where.tenantId).toBe('t-1');
  });

  it('approve gates the compound WHERE on branchId', async () => {
    (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.cashDrawerMovement.findFirstOrThrow as any).mockResolvedValue({
      id: 'm-1', type: 'CASH_OUT', amount: { toString: () => '100' },
    });
    await svc.approve(scope, 'm-1', { id: 'u-1', role: UserRole.MANAGER as any });
    const where = (prisma.cashDrawerMovement.updateMany as any).mock.calls[0][0].where;
    expect(where.branchId).toBe('b-1');
    expect(where.tenantId).toBe('t-1');
  });

  // ── Auditability: privileged money decisions land in user_activities ──
  describe('audit trail (user_activities)', () => {
    it('approve writes a CASH_DRAWER_APPROVED audit with actor + before/after', async () => {
      (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.cashDrawerMovement.findFirstOrThrow as any).mockResolvedValue({
        id: 'm-1', approvalStatus: 'APPROVED', type: 'CASH_OUT', amount: { toString: () => '120' },
      });
      await svc.approve(scope, 'm-1', { id: 'mgr-1', role: UserRole.MANAGER });
      expect(prisma.userActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'mgr-1',
          tenantId: 't-1',
          action: 'CASH_DRAWER_APPROVED',
          metadata: expect.objectContaining({
            movementId: 'm-1',
            type: 'CASH_OUT',
            amount: '120',
            from: 'DRAFT',
            to: 'APPROVED',
            branchId: 'b-1',
          }),
        }),
      });
    });

    it('reject writes a CASH_DRAWER_REJECTED audit including the reason', async () => {
      (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.cashDrawerMovement.findFirstOrThrow as any).mockResolvedValue({
        id: 'm-2', approvalStatus: 'REJECTED', type: 'ADJUSTMENT', amount: { toString: () => '75' },
      });
      await svc.reject(
        scope,
        'm-2',
        { id: 'mgr-9', role: UserRole.ADMIN },
        { reason: 'till count mismatch' },
      );
      expect(prisma.userActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'mgr-9',
          tenantId: 't-1',
          action: 'CASH_DRAWER_REJECTED',
          metadata: expect.objectContaining({
            movementId: 'm-2',
            from: 'DRAFT',
            to: 'REJECTED',
            reason: 'till count mismatch',
            branchId: 'b-1',
          }),
        }),
      });
    });

    it('does NOT write an audit when the approve claim loses the race', async () => {
      (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 0 });
      await expect(
        svc.approve(scope, 'm-1', { id: 'mgr-1', role: UserRole.MANAGER }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.userActivity.create).not.toHaveBeenCalled();
    });

    it('is best-effort: a failing audit write does not break the approval', async () => {
      (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.cashDrawerMovement.findFirstOrThrow as any).mockResolvedValue({
        id: 'm-1', approvalStatus: 'APPROVED', type: 'CASH_OUT', amount: { toString: () => '10' },
      });
      (prisma.userActivity.create as any).mockRejectedValue(new Error('audit sink down'));
      jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
      await expect(
        svc.approve(scope, 'm-1', { id: 'mgr-1', role: UserRole.MANAGER }),
      ).resolves.toEqual(expect.objectContaining({ approvalStatus: 'APPROVED' }));
    });
  });

  // ── Track 2 domain counter: cash_drawer_ops_total ──────────────────
  describe('cash_drawer_ops_total counter', () => {
    let metrics: { incCounter: jest.Mock };

    beforeEach(() => {
      metrics = { incCounter: jest.fn() };
      svc = new CashDrawerService(prisma as any, metrics as any);
    });

    const opByType: Array<[string, string]> = [
      ['OPENING', 'open'],
      ['CLOSING', 'close'],
      ['CASH_IN', 'movement'],
      ['CASH_OUT', 'movement'],
      ['ADJUSTMENT', 'movement'],
    ];
    for (const [type, op] of opByType) {
      it(`create(${type}) records op=${op}`, async () => {
        (prisma.cashDrawerMovement.create as any).mockResolvedValue({ id: 'm-1' });
        await svc.create('t-1', 'b-1', 'u-1', { type: type as any, amount: 10 });
        expect(metrics.incCounter).toHaveBeenCalledWith(
          'cash_drawer_ops_total',
          expect.any(String),
          { op },
        );
      });
    }

    it('approve records op=approve after a winning claim', async () => {
      (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.cashDrawerMovement.findFirstOrThrow as any).mockResolvedValue({
        id: 'm-1', type: 'CASH_OUT', amount: { toString: () => '100' },
      });
      await svc.approve(scope, 'm-1', { id: 'mgr-1', role: UserRole.MANAGER });
      expect(metrics.incCounter).toHaveBeenCalledWith(
        'cash_drawer_ops_total',
        expect.any(String),
        { op: 'approve' },
      );
    });

    it('approve does NOT record when the claim loses the race (count=0)', async () => {
      (prisma.cashDrawerMovement.updateMany as any).mockResolvedValue({ count: 0 });
      await expect(
        svc.approve(scope, 'm-1', { id: 'mgr-1', role: UserRole.MANAGER }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(metrics.incCounter).not.toHaveBeenCalled();
    });

    it('does not throw when no MetricsService is injected (optional dep)', async () => {
      const bare = new CashDrawerService(prisma as any);
      (prisma.cashDrawerMovement.create as any).mockResolvedValue({ id: 'm-1' });
      await expect(
        bare.create('t-1', 'b-1', 'u-1', { type: 'OPENING' as any, amount: 1 }),
      ).resolves.toBeDefined();
    });
  });
});
