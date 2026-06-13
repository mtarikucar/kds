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

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new DeliveryLogService(prisma as any);
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
  });
});
