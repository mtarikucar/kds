import { DeliveryStatusSyncService } from './delivery-status-sync.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';
import { OrderStatus } from '../../../common/constants/order-status.enum';
import { PlatformLogAction } from '../constants/platform.enum';

/**
 * Behaviour locks for status-sync (KDS/POS status change -> platform):
 *
 *  - Correct external mapping: each syncable OrderStatus dispatches the
 *    RIGHT adapter method (PENDING->acceptOrder, PREPARING->markPreparing,
 *    READY->markReady, CANCELLED->cancelOrder). A wrong row in
 *    STATUS_TO_PLATFORM_ACTION would silently tell the courier the wrong
 *    thing.
 *  - Non-syncable statuses (SERVED, PAID, PENDING_APPROVAL) are NOT pushed
 *    — SERVED is a dine-in concept, pushing it as "picked up" would lie to
 *    the platform.
 *  - Tenant scoping: the config is looked up by the order's OWN
 *    {tenantId, platform} compound key, never a bare platform lookup.
 *  - Guard rails: non-delivery orders, disabled configs, and missing
 *    tokens all short-circuit WITHOUT calling the adapter.
 *  - Reliability: adapter failure bumps configService.recordError (the
 *    circuit-breaker) and logs success:false; it never throws to caller.
 */
describe('DeliveryStatusSyncService', () => {
  let prisma: MockPrismaClient;
  let adapterFactory: any;
  let logService: any;
  let authService: any;
  let configService: any;
  let adapter: any;
  let svc: DeliveryStatusSyncService;

  const CONFIG = { id: 'cfg-1', isEnabled: true, platform: 'YEMEKSEPETI', tenantId: 't1' };

  const orderRow = (over: any = {}) => ({
    id: 'ord-1',
    tenantId: 't1',
    source: 'YEMEKSEPETI',
    externalOrderId: 'ext-9',
    ...over,
  });

  beforeEach(() => {
    prisma = mockPrismaClient();
    adapter = {
      acceptOrder: jest.fn().mockResolvedValue(undefined),
      markPreparing: jest.fn().mockResolvedValue(undefined),
      markReady: jest.fn().mockResolvedValue(undefined),
      cancelOrder: jest.fn().mockResolvedValue(undefined),
    };
    adapterFactory = { getAdapter: jest.fn().mockReturnValue(adapter) };
    logService = { log: jest.fn().mockResolvedValue(undefined) };
    authService = { ensureValidToken: jest.fn().mockResolvedValue(CONFIG) };
    configService = { recordError: jest.fn().mockResolvedValue({}) };
    svc = new DeliveryStatusSyncService(
      prisma as any,
      adapterFactory,
      logService,
      authService,
      configService,
    );
  });

  function arrangeHappy(order = orderRow()) {
    (prisma.order.findUnique as any).mockResolvedValue(order);
    (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue(CONFIG);
  }

  describe('external<->internal status mapping correctness', () => {
    const cases: Array<[OrderStatus, string]> = [
      [OrderStatus.PENDING, 'acceptOrder'],
      [OrderStatus.PREPARING, 'markPreparing'],
      [OrderStatus.READY, 'markReady'],
      [OrderStatus.CANCELLED, 'cancelOrder'],
    ];

    it.each(cases)('status %s dispatches adapter.%s with the external order id', async (status, method) => {
      arrangeHappy();

      await svc.syncStatusToPlatform('ord-1', status);

      expect(adapter[method]).toHaveBeenCalledTimes(1);
      expect(adapter[method]).toHaveBeenCalledWith(CONFIG, 'ext-9');
      // No OTHER adapter method may fire for this status.
      for (const [, other] of cases) {
        if (other !== method) expect(adapter[other]).not.toHaveBeenCalled();
      }
    });

    it.each([OrderStatus.SERVED, OrderStatus.PAID, OrderStatus.PENDING_APPROVAL])(
      'non-syncable status %s never touches Prisma or the adapter',
      async (status) => {
        await svc.syncStatusToPlatform('ord-1', status as any);

        expect(prisma.order.findUnique).not.toHaveBeenCalled();
        expect(adapter.acceptOrder).not.toHaveBeenCalled();
        expect(adapter.markReady).not.toHaveBeenCalled();
      },
    );
  });

  describe('tenant scoping', () => {
    it("looks up config by the order's own {tenantId, platform} compound key", async () => {
      arrangeHappy(orderRow({ tenantId: 't-XYZ', source: 'GETIR' }));

      await svc.syncStatusToPlatform('ord-1', OrderStatus.READY);

      expect(prisma.deliveryPlatformConfig.findUnique).toHaveBeenCalledWith({
        where: { tenantId_platform: { tenantId: 't-XYZ', platform: 'GETIR' } },
      });
    });
  });

  describe('guard rails (no adapter call)', () => {
    it('skips orders that are not delivery-platform orders (no source)', async () => {
      (prisma.order.findUnique as any).mockResolvedValue(orderRow({ source: null }));

      await svc.syncStatusToPlatform('ord-1', OrderStatus.READY);

      expect(prisma.deliveryPlatformConfig.findUnique).not.toHaveBeenCalled();
      expect(adapter.markReady).not.toHaveBeenCalled();
    });

    it('skips orders without an externalOrderId', async () => {
      (prisma.order.findUnique as any).mockResolvedValue(orderRow({ externalOrderId: null }));

      await svc.syncStatusToPlatform('ord-1', OrderStatus.READY);

      expect(prisma.deliveryPlatformConfig.findUnique).not.toHaveBeenCalled();
      expect(adapter.markReady).not.toHaveBeenCalled();
    });

    it('skips when the platform config is disabled', async () => {
      (prisma.order.findUnique as any).mockResolvedValue(orderRow());
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({ ...CONFIG, isEnabled: false });

      await svc.syncStatusToPlatform('ord-1', OrderStatus.READY);

      expect(authService.ensureValidToken).not.toHaveBeenCalled();
      expect(adapter.markReady).not.toHaveBeenCalled();
    });

    it('skips when no valid token can be obtained', async () => {
      arrangeHappy();
      authService.ensureValidToken.mockResolvedValue(null);

      await svc.syncStatusToPlatform('ord-1', OrderStatus.READY);

      expect(adapter.markReady).not.toHaveBeenCalled();
    });
  });

  describe('reliability on adapter failure', () => {
    it('bumps configService.recordError and logs success:false, without throwing', async () => {
      arrangeHappy();
      adapter.markReady.mockRejectedValue(new Error('platform 503'));

      await expect(svc.syncStatusToPlatform('ord-1', OrderStatus.READY)).resolves.toBeUndefined();

      expect(configService.recordError).toHaveBeenCalledWith(
        'cfg-1',
        expect.stringContaining('status_sync:'),
      );
      const failLog = logService.log.mock.calls.find((c: any[]) => c[0].success === false);
      expect(failLog).toBeDefined();
      expect(failLog[0]).toMatchObject({
        success: false,
        action: PlatformLogAction.STATUS_UPDATE,
        error: 'platform 503',
      });
    });

    it('logs success:true and does NOT bump the circuit-breaker on the happy path', async () => {
      arrangeHappy();

      await svc.syncStatusToPlatform('ord-1', OrderStatus.PREPARING);

      expect(configService.recordError).not.toHaveBeenCalled();
      const okLog = logService.log.mock.calls.find((c: any[]) => c[0].success === true);
      expect(okLog[0]).toMatchObject({
        success: true,
        action: PlatformLogAction.STATUS_UPDATE,
        externalId: 'ext-9',
      });
    });
  });
});
