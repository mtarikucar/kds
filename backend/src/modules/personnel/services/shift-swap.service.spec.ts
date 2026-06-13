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
});
