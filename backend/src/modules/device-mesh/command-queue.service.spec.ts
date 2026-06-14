import { CommandQueueService } from './command-queue.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/** Minimal ConfigService stub honouring the (key, default) signature. */
function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn((key: string, def?: unknown) =>
      key in overrides ? overrides[key] : def,
    ),
  } as any;
}

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
    svc = new CommandQueueService(prisma as any, outbox as any, makeConfig());
  });

  describe('DEFAULT_TTL config', () => {
    const THIRTY_MIN_MS = 30 * 60 * 1000;

    it('defaults to 30m when DEVICE_COMMAND_TTL_MS is unset', async () => {
      prisma.device.findFirst.mockResolvedValue({ id: 'dev', status: 'online', branchId: 'b' } as any);
      let captured: any = null;
      (prisma.deviceCommand.create as any).mockImplementation(async ({ data }: any) => {
        captured = data;
        return { id: 'c-1', ...data };
      });

      const before = Date.now();
      await svc.enqueue('t', 'dev', { kind: 'print', payload: {} });
      const ttl = captured.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(THIRTY_MIN_MS - 1000);
      expect(ttl).toBeLessThanOrEqual(THIRTY_MIN_MS + 5000);
    });

    it('honours a DEVICE_COMMAND_TTL_MS override', async () => {
      const override = 5 * 60 * 1000;
      svc = new CommandQueueService(
        prisma as any,
        outbox as any,
        makeConfig({ DEVICE_COMMAND_TTL_MS: override }),
      );
      prisma.device.findFirst.mockResolvedValue({ id: 'dev', status: 'online', branchId: 'b' } as any);
      let captured: any = null;
      (prisma.deviceCommand.create as any).mockImplementation(async ({ data }: any) => {
        captured = data;
        return { id: 'c-1', ...data };
      });

      const before = Date.now();
      await svc.enqueue('t', 'dev', { kind: 'print', payload: {} });
      const ttl = captured.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(override - 1000);
      expect(ttl).toBeLessThanOrEqual(override + 5000);
    });
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

  /**
   * Iter-72 regression. The previous sweepStuck did
   * findMany → for...await update — an N+1 round-trip pattern that
   * held the DB connection for one serialised write per stale row.
   * The new shape issues exactly two updateMany statements inside one
   * $transaction (one per attempts-vs-MAX branch) regardless of how
   * many rows are stuck.
   */
  describe('sweepStuck batching (iter-72)', () => {
    it('issues exactly two updateMany calls inside one $transaction', async () => {
      (prisma.$transaction as any).mockImplementation(async (ops: any[]) => {
        // The test mock passes through each updateMany call so we can
        // measure how many statements the service issued. In production
        // Prisma runs them in a single round-trip.
        return Promise.all(ops);
      });
      (prisma.deviceCommand.updateMany as any).mockResolvedValue({ count: 0 });

      await svc.sweepStuck();

      expect((prisma.$transaction as any).mock.calls.length).toBe(1);
      // The first $transaction call's first arg is the array of three
      // updateMany prismas (v2.8.97 added the expired-queued sweep
      // alongside the requeue + fail branches) — length must be 3
      // regardless of how many rows are stale.
      const txArgs = (prisma.$transaction as any).mock.calls[0][0];
      expect(Array.isArray(txArgs)).toBe(true);
      expect(txArgs.length).toBe(3);
      // findMany must NOT fire — that was the N+1 starting point.
      expect((prisma.deviceCommand.findMany as any).mock.calls.length).toBe(0);
    });

    it('returns the combined requeue+fail+expired count', async () => {
      (prisma.$transaction as any).mockResolvedValue([{ count: 3 }, { count: 2 }, { count: 4 }]);

      const total = await svc.sweepStuck();

      expect(total).toBe(9);
    });

    it('predicate splits on attempts vs MAX_ATTEMPTS', async () => {
      const captured: any[] = [];
      (prisma.deviceCommand.updateMany as any).mockImplementation(async (args: any) => {
        captured.push(args);
        return { count: 0 };
      });
      (prisma.$transaction as any).mockImplementation(async (ops: any[]) => Promise.all(ops));

      await svc.sweepStuck();

      // First call requeues (status=queued, attempts < MAX).
      expect(captured[0].data.status).toBe('queued');
      expect(captured[0].where.attempts).toEqual({ lt: 5 });
      // Second call fails (status=failed, attempts >= MAX).
      expect(captured[1].data.status).toBe('failed');
      expect(captured[1].where.attempts).toEqual({ gte: 5 });
    });
  });
});
