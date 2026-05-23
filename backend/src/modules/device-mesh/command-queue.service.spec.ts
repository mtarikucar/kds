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
    prisma.device.findUnique.mockResolvedValue({ id: 'dev', tenantId: 't', status: 'online' } as any);

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
    prisma.deviceCommand.findUnique.mockResolvedValue({
      id: 'c-1', deviceId: 'dev', tenantId: 't', status: 'inflight', attempts: 2, kind: 'print_receipt',
    } as any);
    let capturedFirst: any = null;
    (prisma.deviceCommand.update as any).mockImplementation(async ({ data }: any) => {
      capturedFirst = data;
      return { id: 'c-1', ...data };
    });

    await svc.ack('dev', 'c-1', { status: 'failed', error: 'printer offline' });
    expect(capturedFirst.status).toBe('queued');

    prisma.deviceCommand.findUnique.mockResolvedValue({
      id: 'c-1', deviceId: 'dev', tenantId: 't', status: 'inflight', attempts: 5, kind: 'print_receipt',
    } as any);
    let capturedSecond: any = null;
    (prisma.deviceCommand.update as any).mockImplementation(async ({ data }: any) => {
      capturedSecond = data;
      return { id: 'c-1', ...data };
    });
    await svc.ack('dev', 'c-1', { status: 'failed', error: 'printer offline' });
    expect(capturedSecond.status).toBe('failed');
  });

  it('ack rejects when command does not belong to the device', async () => {
    prisma.deviceCommand.findUnique.mockResolvedValue({
      id: 'c-1', deviceId: 'other-dev', tenantId: 't', status: 'inflight', attempts: 1,
    } as any);
    await expect(svc.ack('dev', 'c-1', { status: 'done' })).rejects.toThrow(/not found/i);
  });
});
