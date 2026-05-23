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
    prisma.installationRequest.findUnique.mockResolvedValue(null);
    await expect(svc.schedule('t1', 'nope', new Date())).rejects.toThrow(/not found/i);

    prisma.installationRequest.findUnique.mockResolvedValue({ id: 'i-1', tenantId: 't-other', status: 'requested' } as any);
    await expect(svc.schedule('t1', 'i-1', new Date())).rejects.toThrow(/not found/i);
  });

  it('schedule rejects from terminal statuses', async () => {
    prisma.installationRequest.findUnique.mockResolvedValue({ id: 'i-1', tenantId: 't1', status: 'done' } as any);
    await expect(svc.schedule('t1', 'i-1', new Date())).rejects.toThrow(/status=done/);
  });

  it('complete sets completedAt and emits installation.completed.v1', async () => {
    prisma.installationRequest.findUnique.mockResolvedValue({ id: 'i-1', tenantId: 't1', status: 'in_progress', notes: '' } as any);
    let captured: any = null;
    (prisma.installationRequest.update as any).mockImplementation(async ({ data }: any) => {
      captured = data;
      return { id: 'i-1', ...data };
    });
    await svc.complete('t1', 'i-1', 'done by team');
    expect(captured.status).toBe('done');
    expect(captured.completedAt).toBeInstanceOf(Date);
    expect(outbox.append).toHaveBeenCalledWith(expect.objectContaining({ type: 'installation.completed.v1' }));
  });
});
