import {
  DeliveryReconciliationService,
  DELIVERY_RECONCILIATION_EVENT,
} from './delivery-reconciliation.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Reconciliation is a READ-ONLY drift sweep over enabled configs:
 *
 *  - Staleness: an enabled POLLING config whose lastOrderPollAt has gone cold
 *    (breaker tripped / token dead) is flagged; a webhook-driven platform with
 *    no poll heartbeat is NOT flagged. A long-stale menu is flagged leniently.
 *  - Count drift: counts internal DELIVERY orders in the window + how many
 *    lack an externalOrderId (un-syncable back to the platform).
 *  - Emits ONE delivery.reconciliation.v1 outbox summary carrying only the
 *    drifted rows, day-bucketed idempotency; no event when nothing drifted.
 *  - Never mutates config/order state.
 */
describe('DeliveryReconciliationService', () => {
  let prisma: MockPrismaClient;
  let outbox: { append: jest.Mock };
  let svc: DeliveryReconciliationService;

  const NOW = new Date('2030-06-15T12:00:00.000Z');

  beforeEach(() => {
    prisma = mockPrismaClient();
    outbox = { append: jest.fn().mockResolvedValue('evt-1') };
    svc = new DeliveryReconciliationService(prisma as any, outbox as any);
    // Default: no orders for any config unless a test overrides.
    (prisma.order.count as any).mockResolvedValue(0);
  });

  it('flags an enabled GETIR config with a cold lastOrderPollAt as poll-stale and emits a summary', async () => {
    (prisma.deliveryPlatformConfig.findMany as any).mockResolvedValue([
      {
        id: 'cfg-1',
        tenantId: 't1',
        platform: 'GETIR',
        branchId: 'b1',
        environment: 'production',
        // 2 hours ago — past the 1h bar.
        lastOrderPollAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
        lastMenuSyncAt: NOW,
        errorCount: 10,
        lastError: 'token expired',
      },
    ]);

    const summary = await svc.reconcile(NOW);

    expect(summary.scannedConfigs).toBe(1);
    expect(summary.driftedConfigs).toBe(1);
    expect(summary.details[0]).toMatchObject({
      configId: 'cfg-1',
      orderPollStale: true,
      menuSyncStale: false,
    });
    expect(outbox.append).toHaveBeenCalledTimes(1);
    const arg = outbox.append.mock.calls[0][0];
    expect(arg.type).toBe(DELIVERY_RECONCILIATION_EVENT);
    expect(arg.tenantId).toBeNull();
    expect(arg.idempotencyKey).toBe('delivery-reconciliation:2030-06-15');
  });

  it('does NOT flag a webhook-driven platform (YEMEKSEPETI) for a null lastOrderPollAt, and emits no event when clean', async () => {
    (prisma.deliveryPlatformConfig.findMany as any).mockResolvedValue([
      {
        id: 'cfg-2',
        tenantId: 't1',
        platform: 'YEMEKSEPETI',
        branchId: null,
        environment: 'production',
        lastOrderPollAt: null, // webhook-driven: never polls
        lastMenuSyncAt: NOW,
        errorCount: 0,
        lastError: null,
      },
    ]);

    const summary = await svc.reconcile(NOW);

    expect(summary.scannedConfigs).toBe(1);
    expect(summary.driftedConfigs).toBe(0);
    expect(summary.details).toHaveLength(0);
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('flags ordersMissingExternalId as drift even when polling is fresh', async () => {
    (prisma.deliveryPlatformConfig.findMany as any).mockResolvedValue([
      {
        id: 'cfg-3',
        tenantId: 't1',
        platform: 'GETIR',
        branchId: 'b1',
        environment: 'production',
        lastOrderPollAt: NOW, // fresh
        lastMenuSyncAt: NOW,
        errorCount: 0,
        lastError: null,
      },
    ]);
    // First count = total in window (5), second = missing externalId (2).
    (prisma.order.count as any)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2);

    const summary = await svc.reconcile(NOW);

    expect(summary.driftedConfigs).toBe(1);
    expect(summary.details[0]).toMatchObject({
      orderPollStale: false,
      internalOrdersInWindow: 5,
      ordersMissingExternalId: 2,
    });
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('flags a long-stale menu sync (lenient bar) on a webhook platform', async () => {
    (prisma.deliveryPlatformConfig.findMany as any).mockResolvedValue([
      {
        id: 'cfg-4',
        tenantId: 't1',
        platform: 'YEMEKSEPETI',
        branchId: null,
        environment: 'production',
        lastOrderPollAt: null,
        // 8 days ago — past the 7-day menu bar.
        lastMenuSyncAt: new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000),
        errorCount: 0,
        lastError: null,
      },
    ]);

    const summary = await svc.reconcile(NOW);

    expect(summary.driftedConfigs).toBe(1);
    expect(summary.details[0].menuSyncStale).toBe(true);
  });

  it('never mutates config or order state', async () => {
    (prisma.deliveryPlatformConfig.findMany as any).mockResolvedValue([
      {
        id: 'cfg-5', tenantId: 't1', platform: 'GETIR', branchId: 'b1',
        environment: 'production', lastOrderPollAt: NOW, lastMenuSyncAt: NOW,
        errorCount: 0, lastError: null,
      },
    ]);

    await svc.reconcile(NOW);

    expect(prisma.deliveryPlatformConfig.update).not.toHaveBeenCalled();
    expect(prisma.deliveryPlatformConfig.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('does not throw when the summary emit fails (best-effort)', async () => {
    outbox.append.mockRejectedValueOnce(new Error('bus down'));
    (prisma.deliveryPlatformConfig.findMany as any).mockResolvedValue([
      {
        id: 'cfg-6', tenantId: 't1', platform: 'GETIR', branchId: 'b1',
        environment: 'production',
        lastOrderPollAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
        lastMenuSyncAt: NOW, errorCount: 11, lastError: 'dead',
      },
    ]);

    await expect(svc.reconcile(NOW)).resolves.toMatchObject({ driftedConfigs: 1 });
  });
});
