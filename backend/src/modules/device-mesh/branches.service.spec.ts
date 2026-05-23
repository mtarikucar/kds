import { BranchesService } from './branches.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

describe('BranchesService', () => {
  let prisma: MockPrismaClient;
  let svc: BranchesService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new BranchesService(prisma as any);
  });

  it('findOrThrow refuses cross-tenant access', async () => {
    prisma.branch.findUnique.mockResolvedValue({ id: 'b-1', tenantId: 't-other' } as any);
    await expect(svc.findOrThrow('t1', 'b-1')).rejects.toThrow(/not found/i);
  });

  it('update rejects unknown status values', async () => {
    prisma.branch.findUnique.mockResolvedValue({ id: 'b-1', tenantId: 't1' } as any);
    await expect(svc.update('t1', 'b-1', { status: 'whatever' })).rejects.toThrow(/Invalid status/);
  });

  it('archive is a status update to archived', async () => {
    prisma.branch.findUnique.mockResolvedValue({ id: 'b-1', tenantId: 't1' } as any);
    let captured: any = null;
    (prisma.branch.update as any).mockImplementation(async ({ data }: any) => {
      captured = data;
      return { id: 'b-1', ...data };
    });
    await svc.archive('t1', 'b-1');
    expect(captured.status).toBe('archived');
  });
});
