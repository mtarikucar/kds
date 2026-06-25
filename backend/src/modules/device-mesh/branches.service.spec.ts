import { BranchesService } from './branches.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

describe('BranchesService', () => {
  let prisma: MockPrismaClient;
  let svc: BranchesService;
  let devices: { countsByBranch: jest.Mock };

  beforeEach(() => {
    prisma = mockPrismaClient();
    devices = { countsByBranch: jest.fn().mockResolvedValue({}) };
    svc = new BranchesService(prisma as any, devices as any);
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

  describe('overview', () => {
    it('returns HQ-first branches with device tallies + bridge counts', async () => {
      (prisma.branch.findMany as any).mockResolvedValue([
        { id: 'hq', name: 'Main', code: 'MAIN', timezone: 'UTC', status: 'active', isHeadquarters: true },
        { id: 'b2', name: 'Kadıköy', code: 'IST-01', timezone: 'UTC', status: 'active', isHeadquarters: false },
      ]);
      devices.countsByBranch.mockResolvedValue({
        hq: { total: 3, online: 2, pending: 1 },
      });
      (prisma.localBridgeAgent.groupBy as any).mockResolvedValue([
        { branchId: 'b2', _count: { _all: 1 } },
      ]);
      const admin = { role: 'ADMIN', primaryBranchId: null, allowedBranchIds: [] };
      const res = await svc.overview('t1', admin);
      expect(res[0]).toMatchObject({ id: 'hq', isHeadquarters: true, devices: { total: 3, online: 2, pending: 1 }, bridges: 0 });
      expect(res[1]).toMatchObject({ id: 'b2', bridges: 1, devices: { total: 0, online: 0, pending: 0 } });
    });

    it('a branch-restricted MANAGER only sees their allowed branches', async () => {
      (prisma.branch.findMany as any).mockResolvedValue([
        { id: 'hq', name: 'Main', code: 'MAIN', timezone: 'UTC', status: 'active', isHeadquarters: true },
        { id: 'b2', name: 'Kadıköy', code: 'IST-01', timezone: 'UTC', status: 'active', isHeadquarters: false },
      ]);
      devices.countsByBranch.mockResolvedValue({});
      (prisma.localBridgeAgent.groupBy as any).mockResolvedValue([]);
      const mgr = { role: 'MANAGER', primaryBranchId: 'b2', allowedBranchIds: ['b2'] };
      const res = await svc.overview('t1', mgr);
      expect(res.map((r: any) => r.id)).toEqual(['b2']); // hq filtered out
    });
  });

  describe('network', () => {
    it('groups devices under their bridge and lists cloud-direct separately', async () => {
      (prisma.branch.findFirst as any).mockResolvedValue({ id: 'b1', tenantId: 't1' });
      (prisma.localBridgeAgent.findMany as any).mockResolvedValue([
        { id: 'br-1', hostname: 'box-1', productSku: 'hummybox-lite', status: 'online', agentVersion: '1', lastSeenAt: null },
      ]);
      (prisma.device.findMany as any).mockResolvedValue([
        { id: 'd1', kind: 'receipt_printer', status: 'online', bridgeId: 'br-1', serial: null, model: null, lastSeenAt: null },
        { id: 'd2', kind: 'kds_screen', status: 'online', bridgeId: null, serial: null, model: null, lastSeenAt: null },
      ]);
      const admin = { role: 'ADMIN', primaryBranchId: null, allowedBranchIds: [] };
      const res = await svc.network('t1', 'b1', admin);
      expect(res.bridges[0].devices.map((d: any) => d.id)).toEqual(['d1']);
      expect(res.cloudDirect.map((d: any) => d.id)).toEqual(['d2']);
    });

    it('404s a branch the tenant does not own', async () => {
      (prisma.branch.findFirst as any).mockResolvedValue(null);
      const admin = { role: 'ADMIN', primaryBranchId: null, allowedBranchIds: [] };
      await expect(svc.network('t1', 'nope', admin)).rejects.toThrow(/not found/i);
    });

    it('404s a branch outside a restricted MANAGER allow-list (no inventory leak)', async () => {
      const mgr = { role: 'MANAGER', primaryBranchId: 'b2', allowedBranchIds: ['b2'] };
      await expect(svc.network('t1', 'other-branch', mgr)).rejects.toThrow(/not found/i);
      // Blocked BEFORE any DB read of the branch row.
      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    });
  });
});
