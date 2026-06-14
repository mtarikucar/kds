import { BadRequestException } from '@nestjs/common';
import { DeliveryLogService } from './delivery-log.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Behaviour locks for the audit-log service:
 *
 *  - PII scrubbing: scrubPii recursively redacts customer-controlled
 *    identifiers (phone/email/address/customer/name/buyer/recipient/gsm)
 *    while keeping debug fields, so the retention table never becomes a
 *    long-term PII store.
 *  - branchId is NOT NULL: log() derives it from the referenced order
 *    when absent, falls back to caller-supplied branchId, and refuses
 *    (returns null) rather than crash when none can be found.
 *  - Best-effort: a DB error in the audit path is swallowed (returns
 *    null), never failing the caller's real work.
 *  - Tenant scoping: getLogs always filters by tenantId.
 *  - Retry/backoff retention: incrementRetry applies exponential backoff
 *    capped at 1h and stops (nextRetryAt=null) once maxRetries is hit.
 */
describe('DeliveryLogService', () => {
  let prisma: MockPrismaClient;
  let svc: DeliveryLogService;
  let metrics: { incDeliveryDlqDepth: jest.Mock; setDeliveryDlqDepth: jest.Mock };

  beforeEach(() => {
    prisma = mockPrismaClient();
    metrics = {
      incDeliveryDlqDepth: jest.fn(),
      setDeliveryDlqDepth: jest.fn(),
    };
    svc = new DeliveryLogService(prisma as any, metrics as any);
  });

  describe('scrubPii', () => {
    it('redacts customer-controlled identifiers recursively but keeps debug fields', () => {
      const raw = {
        externalOrderId: 'ext-1',
        token: 'keep-me',
        customerPhone: '+905551112233',
        buyer: { name: 'Jane', gsmNumber: '555', addressLine: '5th Ave' },
        items: [{ name: 'Burger', price: 10 }],
      };

      const out: any = svc.scrubPii(raw);

      // Debug-relevant fields survive.
      expect(out.externalOrderId).toBe('ext-1');
      expect(out.token).toBe('keep-me');
      // Top-level PII redacted.
      expect(out.customerPhone).toBe('[redacted]');
      // Whole `buyer` key matches /buyer/ -> redacted wholesale.
      expect(out.buyer).toBe('[redacted]');
      // Nested arrays of objects are recursed; `name` is redacted, price kept.
      expect(out.items[0].name).toBe('[redacted]');
      expect(out.items[0].price).toBe(10);
    });

    it('returns primitives and null unchanged', () => {
      expect(svc.scrubPii(null as any)).toBeNull();
      expect(svc.scrubPii('plain' as any)).toBe('plain');
      expect(svc.scrubPii(42 as any)).toBe(42);
    });
  });

  describe('log() branchId resolution (NOT NULL column)', () => {
    it('derives branchId from the referenced order when not supplied', async () => {
      (prisma.order.findUnique as any).mockResolvedValue({ branchId: 'br-from-order' });
      (prisma.deliveryPlatformLog.create as any).mockResolvedValue({ id: 'log-1' });

      await svc.log({
        tenantId: 't1', platform: 'GETIR', direction: 'OUTBOUND',
        action: 'STATUS_UPDATE', orderId: 'ord-1', success: true,
      });

      expect(prisma.order.findUnique).toHaveBeenCalledWith({
        where: { id: 'ord-1' }, select: { branchId: true },
      });
      expect((prisma.deliveryPlatformLog.create as any).mock.calls[0][0].data).toMatchObject({
        tenantId: 't1', branchId: 'br-from-order', success: true,
      });
    });

    it('prefers a caller-supplied branchId without hitting the order table', async () => {
      (prisma.deliveryPlatformLog.create as any).mockResolvedValue({ id: 'log-1' });

      await svc.log({
        tenantId: 't1', branchId: 'br-explicit', platform: 'GETIR',
        direction: 'OUTBOUND', action: 'AUTH_REFRESH', success: true,
      });

      expect(prisma.order.findUnique).not.toHaveBeenCalled();
      expect((prisma.deliveryPlatformLog.create as any).mock.calls[0][0].data.branchId).toBe('br-explicit');
    });

    it('refuses to write (returns null) when no branchId can be resolved', async () => {
      const out = await svc.log({
        tenantId: 't1', platform: 'GETIR', direction: 'OUTBOUND',
        action: 'AUTH_REFRESH', success: true,
      });

      expect(out).toBeNull();
      expect(prisma.deliveryPlatformLog.create).not.toHaveBeenCalled();
    });

    it('defaults maxRetries to 3 when not provided', async () => {
      (prisma.deliveryPlatformLog.create as any).mockResolvedValue({ id: 'log-1' });

      await svc.log({
        tenantId: 't1', branchId: 'br-1', platform: 'GETIR',
        direction: 'OUTBOUND', action: 'STATUS_UPDATE', success: false,
      });

      expect((prisma.deliveryPlatformLog.create as any).mock.calls[0][0].data.maxRetries).toBe(3);
    });
  });

  describe('best-effort write', () => {
    it('swallows a DB error and returns null instead of throwing', async () => {
      (prisma.deliveryPlatformLog.create as any).mockRejectedValue(new Error('DB down'));

      const out = await svc.log({
        tenantId: 't1', branchId: 'br-1', platform: 'GETIR',
        direction: 'OUTBOUND', action: 'STATUS_UPDATE', success: true,
      });

      expect(out).toBeNull();
    });
  });

  describe('tenant scoping on reads', () => {
    it('getLogs always filters by tenantId and applies optional filters', async () => {
      (prisma.deliveryPlatformLog.findMany as any).mockResolvedValue([{ id: 'l1' }]);
      (prisma.deliveryPlatformLog.count as any).mockResolvedValue(1);

      const out = await svc.getLogs('t1', { platform: 'GETIR', success: false, limit: 10, offset: 5 });

      const whereArg = (prisma.deliveryPlatformLog.findMany as any).mock.calls[0][0];
      expect(whereArg.where).toEqual({ tenantId: 't1', platform: 'GETIR', success: false });
      expect(whereArg.take).toBe(10);
      expect(whereArg.skip).toBe(5);
      expect(out).toEqual({ logs: [{ id: 'l1' }], total: 1 });
    });
  });

  describe('retry retention / backoff', () => {
    it('incrementRetry applies exponential backoff while retries remain', async () => {
      (prisma.deliveryPlatformLog.findUnique as any).mockResolvedValue({
        id: 'log-1', retryCount: 1, maxRetries: 3,
      });
      const before = Date.now();

      await svc.incrementRetry('log-1');

      const data = (prisma.deliveryPlatformLog.update as any).mock.calls[0][0].data;
      expect(data.retryCount).toBe(2);
      // backoff = min(60_000 * 2^2, 3_600_000) = 240_000ms ahead.
      const delta = data.nextRetryAt.getTime() - before;
      expect(delta).toBeGreaterThanOrEqual(240_000 - 1000);
      expect(delta).toBeLessThanOrEqual(240_000 + 5000);
    });

    it('incrementRetry stops scheduling (nextRetryAt=null) once maxRetries is reached', async () => {
      (prisma.deliveryPlatformLog.findUnique as any).mockResolvedValue({
        id: 'log-1', retryCount: 2, maxRetries: 3,
      });

      await svc.incrementRetry('log-1');

      const data = (prisma.deliveryPlatformLog.update as any).mock.calls[0][0].data;
      expect(data.retryCount).toBe(3);
      expect(data.nextRetryAt).toBeNull();
    });

    it('incrementRetry is a no-op for an unknown log id', async () => {
      (prisma.deliveryPlatformLog.findUnique as any).mockResolvedValue(null);

      await svc.incrementRetry('missing');

      expect(prisma.deliveryPlatformLog.update).not.toHaveBeenCalled();
    });

    it('incrementRetry bumps the delivery DLQ gauge when a row crosses into the terminal state', async () => {
      // retryCount 2 -> 3 with maxRetries 3 means nextRetryAt becomes null:
      // the row just entered the dead-letter terminal state, so the inline
      // gauge inc must fire exactly once.
      (prisma.deliveryPlatformLog.findUnique as any).mockResolvedValue({
        id: 'log-1', retryCount: 2, maxRetries: 3,
      });

      await svc.incrementRetry('log-1');

      expect(metrics.incDeliveryDlqDepth).toHaveBeenCalledTimes(1);
    });

    it('incrementRetry does NOT bump the gauge while retries remain', async () => {
      (prisma.deliveryPlatformLog.findUnique as any).mockResolvedValue({
        id: 'log-1', retryCount: 0, maxRetries: 3,
      });

      await svc.incrementRetry('log-1');

      expect(metrics.incDeliveryDlqDepth).not.toHaveBeenCalled();
    });
  });

  describe('dead-letter queue readout', () => {
    it('getDeadLetters filters to the terminal state (success=false, nextRetryAt=null, retries exhausted)', async () => {
      (prisma.deliveryPlatformLog.findMany as any).mockResolvedValue([
        { id: 'dl-2' }, { id: 'dl-1' },
      ]);

      const out = await svc.getDeadLetters({ tenantId: 't1', platform: 'GETIR', limit: 50 });

      const arg = (prisma.deliveryPlatformLog.findMany as any).mock.calls[0][0];
      expect(arg.where).toMatchObject({
        tenantId: 't1',
        platform: 'GETIR',
        success: false,
        nextRetryAt: null,
      });
      // The retryCount>=maxRetries half is expressed as a column-to-column
      // comparison (Prisma field reference) so assert the predicate KEY is
      // present rather than its opaque encoding.
      expect(arg.where).toHaveProperty('retryCount');
      expect(arg.where.success).toBe(false);
      expect(arg.where.nextRetryAt).toBeNull();
      expect(out.items).toHaveLength(2);
      expect(out.nextCursor).toBeNull();
    });

    it('getDeadLetters clamps limit to [1,200] and paginates by cursor', async () => {
      (prisma.deliveryPlatformLog.findMany as any).mockResolvedValue([
        { id: 'dl-3' }, { id: 'dl-2' }, { id: 'dl-1' },
      ]);

      const out = await svc.getDeadLetters({ limit: 2, cursor: 'dl-9' });

      const arg = (prisma.deliveryPlatformLog.findMany as any).mock.calls[0][0];
      expect(arg.take).toBe(3); // limit(2) + 1 to detect hasMore
      expect(arg.cursor).toEqual({ id: 'dl-9' });
      expect(arg.skip).toBe(1);
      expect(out.items).toHaveLength(2);
      expect(out.nextCursor).toBe('dl-2');
    });

    it('getDeadLetters works tenant-wide (no tenantId) for SuperAdmin readout', async () => {
      (prisma.deliveryPlatformLog.findMany as any).mockResolvedValue([]);

      await svc.getDeadLetters({});

      const where = (prisma.deliveryPlatformLog.findMany as any).mock.calls[0][0].where;
      expect(where.tenantId).toBeUndefined();
      expect(where.success).toBe(false);
      expect(where.nextRetryAt).toBeNull();
    });

    it('dlqDepth COUNTs exactly the terminal set and re-syncs the gauge', async () => {
      (prisma.deliveryPlatformLog.count as any).mockResolvedValue(7);

      const n = await svc.dlqDepth();

      expect(n).toBe(7);
      const where = (prisma.deliveryPlatformLog.count as any).mock.calls[0][0].where;
      expect(where.success).toBe(false);
      expect(where.nextRetryAt).toBeNull();
      // Re-sync side effect keeps the inline-incremented gauge honest.
      expect(metrics.setDeliveryDlqDepth).toHaveBeenCalledWith(7);
    });

    it('dlqDepth can scope by tenantId/platform', async () => {
      (prisma.deliveryPlatformLog.count as any).mockResolvedValue(2);

      await svc.dlqDepth({ tenantId: 't1', platform: 'TRENDYOL' });

      const where = (prisma.deliveryPlatformLog.count as any).mock.calls[0][0].where;
      expect(where.tenantId).toBe('t1');
      expect(where.platform).toBe('TRENDYOL');
    });
  });

  describe('requeueDeadLetters', () => {
    it('sets nextRetryAt=now so the EXISTING RetryScheduler re-claims, without resetting attempts by default', async () => {
      (prisma.deliveryPlatformLog.updateMany as any).mockResolvedValue({ count: 2 });
      const before = Date.now();

      const out = await svc.requeueDeadLetters(['dl-1', 'dl-2']);

      const arg = (prisma.deliveryPlatformLog.updateMany as any).mock.calls[0][0];
      // Only rows still in the terminal state are eligible.
      expect(arg.where).toMatchObject({
        id: { in: ['dl-1', 'dl-2'] },
        success: false,
        nextRetryAt: null,
      });
      expect(arg.data.nextRetryAt).toBeInstanceOf(Date);
      expect(arg.data.nextRetryAt.getTime()).toBeGreaterThanOrEqual(before);
      // resetAttempts defaults FALSE — a poison-pill row keeps its exhausted
      // counter so it re-DLQs after one more failed tick instead of looping.
      expect(arg.data.retryCount).toBeUndefined();
      expect(out).toEqual({ requeued: 2, requested: 2 });
    });

    it('optionally resets retryCount to 0 when caller passes resetAttempts', async () => {
      (prisma.deliveryPlatformLog.updateMany as any).mockResolvedValue({ count: 1 });

      await svc.requeueDeadLetters(['dl-1'], { resetAttempts: true });

      const arg = (prisma.deliveryPlatformLog.updateMany as any).mock.calls[0][0];
      expect(arg.data.retryCount).toBe(0);
    });

    it('fences the updateMany by tenantId when caller scopes it (no cross-tenant replay)', async () => {
      (prisma.deliveryPlatformLog.updateMany as any).mockResolvedValue({ count: 1 });

      await svc.requeueDeadLetters(['dl-1'], { tenantId: 't1' });

      const where = (prisma.deliveryPlatformLog.updateMany as any).mock.calls[0][0].where;
      expect(where.tenantId).toBe('t1');
    });

    it('re-syncs the gauge after a requeue (rows left the terminal set)', async () => {
      (prisma.deliveryPlatformLog.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.deliveryPlatformLog.count as any).mockResolvedValue(4);

      await svc.requeueDeadLetters(['dl-1']);

      expect(metrics.setDeliveryDlqDepth).toHaveBeenCalledWith(4);
    });

    it('rejects an empty id list', async () => {
      await expect(svc.requeueDeadLetters([])).rejects.toThrow(BadRequestException);
    });

    it('rejects more than 100 ids to bound blast radius', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `dl-${i}`);
      await expect(svc.requeueDeadLetters(ids)).rejects.toThrow(BadRequestException);
    });
  });
});
