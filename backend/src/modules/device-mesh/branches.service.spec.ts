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
    (prisma.branch.updateMany as any).mockImplementation(async ({ data }: any) => {
      captured = data;
      return { count: 1 };
    });
    (prisma.branch.findFirstOrThrow as any).mockResolvedValue({ id: 'b-1', tenantId: 't1', status: 'archived' });
    await svc.archive('t1', 'b-1');
    expect(captured.status).toBe('archived');
  });

  /**
   * Iter-73 regression. update() previously did .update({where:{id}})
   * without the tenantId compound, so a future refactor that drops
   * the preceding findOrThrow could leak into a cross-tenant rename
   * or status flip. Switched to updateMany + (id, tenantId) WHERE +
   * count-check. The find-by-id portion of the old read is also gone
   * (findOrThrow already did the tenant-scoped read).
   */
  describe('iter-73 compound-WHERE on update', () => {
    it('writes via updateMany with (id, tenantId) WHERE', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: 'b-1', tenantId: 't1' } as any);
      let updateWhere: any = null;
      (prisma.branch.updateMany as any).mockImplementation(async ({ where }: any) => {
        updateWhere = where;
        return { count: 1 };
      });
      (prisma.branch.findFirstOrThrow as any).mockResolvedValue({ id: 'b-1', tenantId: 't1' });

      await svc.update('t1', 'b-1', { name: 'Renamed' });

      expect(updateWhere).toEqual({ id: 'b-1', tenantId: 't1' });
    });

    it('count=0 surfaces NotFoundException (TOCTOU between findOrThrow and write)', async () => {
      prisma.branch.findFirst.mockResolvedValue({ id: 'b-1', tenantId: 't1' } as any);
      (prisma.branch.updateMany as any).mockResolvedValue({ count: 0 });
      await expect(svc.update('t1', 'b-1', { name: 'Renamed' })).rejects.toThrow(/not found/i);
    });
  });
});
