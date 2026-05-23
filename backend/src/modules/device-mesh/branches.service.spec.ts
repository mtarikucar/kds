import { BranchesService } from './branches.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

describe('BranchesService', () => {
  let prisma: MockPrismaClient;
  let svc: BranchesService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new BranchesService(prisma as any);
  });

  it('findOrThrow refuses cross-tenant access (compound WHERE returns null)', async () => {
    // After iter-35, findOrThrow uses findFirst({where:{id, tenantId}}).
    // A cross-tenant request never gets a row back from the DB at all —
    // mock null. (Previously this test mocked findUnique returning a
    // row with a foreign tenantId and the service did a manual !== check.)
    prisma.branch.findFirst.mockResolvedValue(null);
    await expect(svc.findOrThrow('t1', 'b-1')).rejects.toThrow(/not found/i);
  });

  it('update rejects unknown status values', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: 'b-1', tenantId: 't1' } as any);
    await expect(svc.update('t1', 'b-1', { status: 'whatever' })).rejects.toThrow(/Invalid status/);
  });

  it('archive is a status update to archived', async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: 'b-1', tenantId: 't1' } as any);
    let captured: any = null;
    (prisma.branch.update as any).mockImplementation(async ({ data }: any) => {
      captured = data;
      return { id: 'b-1', ...data };
    });
    await svc.archive('t1', 'b-1');
    expect(captured.status).toBe('archived');
  });
});
