import { InstallationService } from './installation.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

describe('InstallationService', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: InstallationService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('ok') };
    svc = new InstallationService(prisma as any, outbox as any);
  });

  it('creates a request and emits installation.requested.v1', async () => {
    (prisma.installationRequest.create as any).mockImplementation(async ({ data }: any) => ({ id: 'i-1', ...data }));
    await svc.create('t1', { branchId: 'b-1', preferredDates: [new Date()] });
    expect(outbox.append).toHaveBeenCalledWith(expect.objectContaining({ type: 'installation.requested.v1' }));
  });

  it('schedule rejects unknown ids and tenant mismatches', async () => {
    // After iter-37 the service uses findFirst({where:{id, tenantId}}),
    // so both the "unknown id" and "wrong tenant" cases collapse to
    // findFirst returning null at the DB layer.
    prisma.installationRequest.findFirst.mockResolvedValue(null);
    await expect(svc.schedule('t1', 'nope', new Date())).rejects.toThrow(/not found/i);
    await expect(svc.schedule('t1', 'i-1', new Date())).rejects.toThrow(/not found/i);
  });

  it('schedule rejects from terminal statuses', async () => {
    prisma.installationRequest.findFirst.mockResolvedValue({ id: 'i-1', tenantId: 't1', status: 'done' } as any);
    await expect(svc.schedule('t1', 'i-1', new Date())).rejects.toThrow(/status=done/);
  });

  it('complete sets completedAt and emits installation.completed.v1', async () => {
    prisma.installationRequest.findFirst.mockResolvedValue({ id: 'i-1', tenantId: 't1', status: 'in_progress', notes: '' } as any);
    let captured: any = null;
    (prisma.installationRequest.updateMany as any).mockImplementation(async ({ data }: any) => {
      captured = data;
      return { count: 1 };
    });
    // iter-37 made complete() re-read via findFirstOrThrow (tenant-scoped) and
    // feed updated.hwOrderId into syncOrderInstallation (null = standalone
    // request, no linked hardware order → sync no-ops).
    (prisma.installationRequest.findFirstOrThrow as any).mockImplementation(async () => ({
      id: 'i-1',
      tenantId: 't1',
      status: 'done',
      completedAt: new Date(),
      notes: 'done by team',
      hwOrderId: null,
    }));
    await svc.complete('t1', 'i-1', 'done by team');
    expect(captured.status).toBe('done');
    expect(captured.completedAt).toBeInstanceOf(Date);
    expect(outbox.append).toHaveBeenCalledWith(expect.objectContaining({ type: 'installation.completed.v1' }));
  });

  it('complete is idempotent — re-completing a done row is rejected', async () => {
    // findFirst still finds it (tenant matches) but the updateMany
    // compound WHERE excludes status=done so claim.count is 0 and we
    // throw.
    prisma.installationRequest.findFirst.mockResolvedValue({ id: 'i-1', tenantId: 't1', status: 'done', notes: '' } as any);
    (prisma.installationRequest.updateMany as any).mockResolvedValue({ count: 0 });
    await expect(svc.complete('t1', 'i-1')).rejects.toThrow(/Cannot complete from status=done/);
  });
});
