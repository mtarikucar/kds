import { ShiftSwapService } from './shift-swap.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';

/**
 * Track-1 branch-scope hardening: listing swap requests must be scoped
 * to the active branch. Cross-branch swaps are already forbidden on the
 * write path; the list read must not leak other branches' requests.
 */
describe('ShiftSwapService branch-scope (track-1)', () => {
  let prisma: MockPrismaClient;
  let kdsGateway: any;
  let svc: ShiftSwapService;
  const scope = {
    tenantId: 't-1',
    branchId: 'b-1',
    userId: 'u-1',
    role: 'MANAGER',
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    kdsGateway = { emitSwapRequestUpdate: jest.fn() };
    svc = new ShiftSwapService(prisma as any, kdsGateway);
  });

  it('findAll filters by branchId + tenantId', async () => {
    (prisma.shiftSwapRequest.findMany as any).mockResolvedValue([]);

    await svc.findAll(scope);

    const where = (prisma.shiftSwapRequest.findMany as any).mock.calls[0][0]
      .where;
    expect(where.branchId).toBe('b-1');
    expect(where.tenantId).toBe('t-1');
  });

  it('createRequest scopes both assignment lookups by branchId', async () => {
    (prisma.user.findFirst as any).mockResolvedValue({ id: 'target' });
    (prisma.shiftAssignment.findFirst as any)
      .mockResolvedValueOnce({
        id: 'ra-1',
        userId: 'u-1',
        tenantId: 't-1',
        branchId: 'b-1',
        status: 'SCHEDULED',
      })
      .mockResolvedValueOnce({
        id: 'ta-1',
        userId: 'target',
        tenantId: 't-1',
        branchId: 'b-1',
        status: 'SCHEDULED',
      });
    (prisma.shiftSwapRequest.create as any).mockResolvedValue({
      id: 'sw-1',
      branchId: 'b-1',
    });

    await svc.createRequest(scope, 'u-1', {
      targetId: 'target',
      requesterAssignmentId: 'ra-1',
      targetAssignmentId: 'ta-1',
    } as any);

    const reqWhere = (prisma.shiftAssignment.findFirst as any).mock.calls[0][0]
      .where;
    expect(reqWhere.branchId).toBe('b-1');
    expect(reqWhere.tenantId).toBe('t-1');
    const targetWhere = (prisma.shiftAssignment.findFirst as any).mock
      .calls[1][0].where;
    expect(targetWhere.branchId).toBe('b-1');
    expect(targetWhere.tenantId).toBe('t-1');
  });

  it('respondAsTarget scopes the request find + claim by branchId', async () => {
    (prisma.shiftSwapRequest.findFirst as any).mockResolvedValue({
      id: 'sw-1',
      tenantId: 't-1',
      branchId: 'b-1',
      targetId: 'u-1',
      status: 'PENDING',
    });
    (prisma.shiftSwapRequest.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.shiftSwapRequest.findFirstOrThrow as any).mockResolvedValue({
      id: 'sw-1',
      branchId: 'b-1',
    });

    await svc.respondAsTarget('sw-1', scope, 'u-1', true);

    const findWhere = (prisma.shiftSwapRequest.findFirst as any).mock.calls[0][0]
      .where;
    expect(findWhere.branchId).toBe('b-1');
    expect(findWhere.tenantId).toBe('t-1');
    const claimWhere = (prisma.shiftSwapRequest.updateMany as any).mock
      .calls[0][0].where;
    expect(claimWhere.branchId).toBe('b-1');
    expect(claimWhere.tenantId).toBe('t-1');
  });

  it('approve scopes the request lookup by branchId', async () => {
    (prisma.shiftSwapRequest.findFirst as any).mockResolvedValue({
      id: 'sw-1',
      tenantId: 't-1',
      branchId: 'b-1',
      requesterId: 'r-1',
      targetId: 't-2',
      requesterAssignmentId: 'ra-1',
      targetAssignmentId: 'ta-1',
      status: 'TARGET_ACCEPTED',
    });
    (prisma.$transaction as any).mockImplementation(async (fn: any) => {
      const tx = {
        shiftAssignment: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({
              id: 'ta-1',
              date: new Date('2026-01-01'),
              shiftTemplateId: 'st-t',
            })
            .mockResolvedValueOnce({
              id: 'ra-1',
              date: new Date('2026-01-01'),
              shiftTemplateId: 'st-r',
            }),
          update: jest.fn().mockResolvedValue({}),
        },
        shiftSwapRequest: {
          update: jest
            .fn()
            .mockResolvedValue({ id: 'sw-1', branchId: 'b-1' }),
        },
      };
      return fn(tx);
    });

    await svc.approve('sw-1', scope, 'mgr-1');

    const where = (prisma.shiftSwapRequest.findFirst as any).mock.calls[0][0]
      .where;
    expect(where.id).toBe('sw-1');
    expect(where.branchId).toBe('b-1');
    expect(where.tenantId).toBe('t-1');
  });

  it('branch-scopes the different-date double-booking check (multi-branch employee not falsely blocked)', async () => {
    (prisma.shiftSwapRequest.findFirst as any).mockResolvedValue({
      id: 'sw-1',
      tenantId: 't-1',
      branchId: 'b-1',
      requesterId: 'r-1',
      targetId: 't-2',
      requesterAssignmentId: 'ra-1',
      targetAssignmentId: 'ta-1',
      status: 'TARGET_ACCEPTED',
    });
    const conflictWheres: any[] = [];
    (prisma.$transaction as any).mockImplementation(async (fn: any) => {
      const findFirst = jest
        .fn()
        // 1: targetAssignment ; 2: reqAssignment (DIFFERENT date → conflict check runs)
        .mockResolvedValueOnce({
          id: 'ta-1',
          date: new Date('2026-01-02'),
          shiftTemplateId: 'st-t',
        })
        .mockResolvedValueOnce({
          id: 'ra-1',
          date: new Date('2026-01-01'),
          shiftTemplateId: 'st-r',
        })
        // 3 + 4: the double-booking lookups — capture WHERE, report no conflict
        .mockImplementation(async ({ where }: any) => {
          conflictWheres.push(where);
          return null;
        });
      const tx = {
        shiftAssignment: { findFirst, update: jest.fn().mockResolvedValue({}) },
        shiftSwapRequest: {
          update: jest.fn().mockResolvedValue({ id: 'sw-1', branchId: 'b-1' }),
        },
      };
      return fn(tx);
    });

    await svc.approve('sw-1', scope, 'mgr-1');

    // Both double-booking lookups must be scoped to the swap's branch, not
    // tenant-wide: otherwise a shift the user holds on that date in ANOTHER
    // branch is a false conflict that blocks a legitimate swap.
    expect(conflictWheres).toHaveLength(2);
    for (const w of conflictWheres) {
      expect(w.branchId).toBe('b-1');
      expect(w.tenantId).toBe('t-1');
    }
  });

  it('reject scopes the request find + claim by branchId', async () => {
    (prisma.shiftSwapRequest.findFirst as any).mockResolvedValue({
      id: 'sw-1',
      tenantId: 't-1',
      branchId: 'b-1',
      status: 'PENDING',
    });
    (prisma.shiftSwapRequest.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.shiftSwapRequest.findFirstOrThrow as any).mockResolvedValue({
      id: 'sw-1',
      branchId: 'b-1',
    });

    await svc.reject('sw-1', scope, 'mgr-1');

    const findWhere = (prisma.shiftSwapRequest.findFirst as any).mock.calls[0][0]
      .where;
    expect(findWhere.branchId).toBe('b-1');
    expect(findWhere.tenantId).toBe('t-1');
    const claimWhere = (prisma.shiftSwapRequest.updateMany as any).mock
      .calls[0][0].where;
    expect(claimWhere.branchId).toBe('b-1');
    expect(claimWhere.tenantId).toBe('t-1');
  });
});
