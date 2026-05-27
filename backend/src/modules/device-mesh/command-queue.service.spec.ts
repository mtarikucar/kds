import { CommandQueueService } from './command-queue.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * CommandQueueService talks raw SQL for the atomic claim path; here we focus
 * on the idempotency-on-create branch and the ack state machine, which sit
 * on top of regular Prisma calls and are amenable to mocking.
 */
describe('CommandQueueService', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: CommandQueueService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('ok') };
    svc = new CommandQueueService(prisma as any, outbox as any);
  });

  it('enqueue dedupes on (deviceId, idempotencyKey)', async () => {
    prisma.device.findFirst.mockResolvedValue({ id: 'dev', status: 'online' } as any);

    const { Prisma } = await import('@prisma/client');
    let attempt = 0;
    (prisma.deviceCommand.create as any).mockImplementation(async () => {
      attempt += 1;
      if (attempt === 1) {
        return { id: 'c-1', tenantId: 't', deviceId: 'dev', kind: 'print_receipt' };
      }
      // Real Prisma error so the `instanceof` check the service does walks
      // the dedup branch.
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.x',
      } as any);
    });
    (prisma.deviceCommand.findUnique as any).mockResolvedValue({ id: 'c-1' });

    const first = await svc.enqueue('t', 'dev', {
      kind: 'print_receipt', payload: {}, idempotencyKey: 'fixed',
    });
    const second = await svc.enqueue('t', 'dev', {
      kind: 'print_receipt', payload: {}, idempotencyKey: 'fixed',
    });
    expect(first.id).toBe('c-1');
    expect(second.id).toBe('c-1');
  });

  it('ack(failed) requeues until MAX_ATTEMPTS, then marks failed', async () => {
    // iter-28: ack now uses findFirst + updateMany + findUniqueOrThrow.
    prisma.deviceCommand.findFirst.mockResolvedValue({
      id: 'c-1', deviceId: 'dev', tenantId: 't', status: 'inflight', attempts: 2, kind: 'print_receipt',
    } as any);
    let capturedFirst: any = null;
    (prisma.deviceCommand.updateMany as any).mockImplementation(async ({ data }: any) => {
      capturedFirst = data;
      return { count: 1 };
    });
    (prisma.deviceCommand.findUniqueOrThrow as any).mockResolvedValue({
      id: 'c-1', deviceId: 'dev', tenantId: 't', status: 'queued',
    });

    await svc.ack('dev', 'c-1', { status: 'failed', error: 'printer offline' });
    expect(capturedFirst.status).toBe('queued');

    prisma.deviceCommand.findFirst.mockResolvedValue({
      id: 'c-1', deviceId: 'dev', tenantId: 't', status: 'inflight', attempts: 5, kind: 'print_receipt',
    } as any);
    let capturedSecond: any = null;
    (prisma.deviceCommand.updateMany as any).mockImplementation(async ({ data }: any) => {
      capturedSecond = data;
      return { count: 1 };
    });
    (prisma.deviceCommand.findUniqueOrThrow as any).mockResolvedValue({
      id: 'c-1', deviceId: 'dev', tenantId: 't', status: 'failed',
    });
    await svc.ack('dev', 'c-1', { status: 'failed', error: 'printer offline' });
    expect(capturedSecond.status).toBe('failed');
  });

  it('ack rejects when command does not belong to the device (iter-28: scope at DB layer)', async () => {
    // The findFirst's compound WHERE now returns null when deviceId
    // doesn't match — no in-JS post-fetch comparison. A future
    // refactor that drops the WHERE clause would surface as this test
    // returning the row and the assertion below failing.
    prisma.deviceCommand.findFirst.mockResolvedValue(null);
    await expect(svc.ack('dev', 'c-1', { status: 'done' })).rejects.toThrow(/not found/i);

    // Pin the compound WHERE shape so the DB-layer scope can't silently
    // regress to in-JS filtering.
    const where = (prisma.deviceCommand.findFirst as any).mock.calls[0][0].where;
    expect(where).toEqual({ id: 'c-1', deviceId: 'dev' });
  });

  it('ack throws on concurrent transition when updateMany claims zero rows (iter-28)', async () => {
    // Inflight when read, but a sweepStuck cron raced ahead and flipped
    // it to queued/failed between read and write. The compound-WHERE
    // updateMany returns count=0; service must surface that rather
    // than silently no-op.
    prisma.deviceCommand.findFirst.mockResolvedValue({
      id: 'c-1', deviceId: 'dev', tenantId: 't', status: 'inflight', attempts: 1, kind: 'print_receipt',
    } as any);
    (prisma.deviceCommand.updateMany as any).mockResolvedValue({ count: 0 });

    await expect(svc.ack('dev', 'c-1', { status: 'done' })).rejects.toThrow(/concurrent/i);
  });
});
