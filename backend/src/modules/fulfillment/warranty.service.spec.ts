import { WarrantyService } from './warranty.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

describe('WarrantyService', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: WarrantyService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('ok') };
    svc = new WarrantyService(prisma as any, outbox as any);
  });

  it('creates a warranty with start=now and end=now+months', async () => {
    let captured: any = null;
    (prisma.warranty.create as any).mockImplementation(async ({ data }: any) => {
      captured = data;
      return { id: 'w-1', ...data };
    });

    await svc.createForSerial('t1', { productId: 'p-1', serial: 'SN001', warrantyMonths: 12 });

    expect(captured.tenantId).toBe('t1');
    expect(captured.status).toBe('active');
    const days = (captured.endAt.getTime() - captured.startAt.getTime()) / (1000 * 60 * 60 * 24);
    expect(Math.round(days)).toBe(12 * 30);
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warranty.created.v1' }),
    );
  });

  it('rejects claims against a warranty in another tenant (compound WHERE returns null)', async () => {
    // After iter-37 the service uses findFirst({where:{id, tenantId}}),
    // so a cross-tenant request never gets a row back. (Previously this
    // mocked findUnique returning a foreign-tenant row.)
    prisma.warranty.findFirst.mockResolvedValue(null);
    await expect(svc.fileClaim('t1', 'w-1', { issue: 'broken' })).rejects.toThrow(/not found/i);
  });

  it('rejects claims against expired warranties', async () => {
    prisma.warranty.findFirst.mockResolvedValue({ id: 'w-1', tenantId: 't1', status: 'expired' } as any);
    await expect(svc.fileClaim('t1', 'w-1', { issue: 'broken' })).rejects.toThrow(/status=expired/);
  });

  it('files a claim and emits an event', async () => {
    prisma.warranty.findFirst.mockResolvedValue({ id: 'w-1', tenantId: 't1', status: 'active' } as any);
    (prisma.warranty.update as any).mockResolvedValue({ id: 'w-1', claims: [{}] });
    await svc.fileClaim('t1', 'w-1', { issue: 'screen flickers', severity: 'high', description: 'after 6 months' });
    expect(outbox.append).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warranty.claim.filed.v1' }),
    );
  });

  it('sweepExpired flips active rows past endAt to expired', async () => {
    (prisma.warranty.updateMany as any).mockResolvedValue({ count: 3 });
    const n = await svc.sweepExpired();
    expect(n).toBe(3);
  });
});
