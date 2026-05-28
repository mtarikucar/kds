import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DeliveryMenuSyncService } from './delivery-menu-sync.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Iter-38 regressions:
 *
 *  1. createMapping must translate P2002 (unique constraint on
 *     [tenantId, platform, externalItemId]) into a friendly
 *     ConflictException — earlier it surfaced raw 500.
 *  2. deleteMapping must throw NotFoundException on stale ids — earlier
 *     it returned { count: 0 } silently.
 *  3. syncMenuToPlatform / updateItemAvailability must call
 *     configService.recordError on failure so the circuit-breaker can
 *     fire (parity with delivery-auth.refreshToken).
 */
describe('DeliveryMenuSyncService (iter-38)', () => {
  let prisma: MockPrismaClient;
  let adapterFactory: any;
  let logService: any;
  let authService: any;
  let configService: any;
  let svc: DeliveryMenuSyncService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    adapterFactory = { getAdapter: jest.fn() };
    logService = { log: jest.fn().mockResolvedValue(undefined) };
    authService = { ensureValidToken: jest.fn() };
    configService = { recordError: jest.fn().mockResolvedValue({}) };
    svc = new DeliveryMenuSyncService(
      prisma as any,
      adapterFactory,
      logService,
      authService,
      configService,
    );
  });

  describe('createMapping', () => {
    it('translates P2002 unique-constraint into ConflictException', async () => {
      (prisma.product.findFirst as any).mockResolvedValue({ id: 'p-1' });
      (prisma.menuItemMapping.create as any).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.x',
        } as any),
      );

      await expect(
        svc.createMapping('t1', 'p-1', 'YEMEKSEPETI', 'ext-123'),
      ).rejects.toThrow(ConflictException);
    });

    it('re-raises non-P2002 errors unchanged', async () => {
      (prisma.product.findFirst as any).mockResolvedValue({ id: 'p-1' });
      const original = new Error('connection pool exhausted');
      (prisma.menuItemMapping.create as any).mockRejectedValue(original);

      await expect(
        svc.createMapping('t1', 'p-1', 'YEMEKSEPETI', 'ext-123'),
      ).rejects.toBe(original);
    });
  });

  describe('deleteMapping', () => {
    it('throws NotFoundException when no row matches (stale id or wrong tenant)', async () => {
      (prisma.menuItemMapping.deleteMany as any).mockResolvedValue({ count: 0 });

      await expect(svc.deleteMapping('t1', 'missing-id')).rejects.toThrow(NotFoundException);
    });

    it('returns the deleteMany result on the happy path', async () => {
      (prisma.menuItemMapping.deleteMany as any).mockResolvedValue({ count: 1 });

      const out = await svc.deleteMapping('t1', 'm-1');
      expect(out.count).toBe(1);
    });
  });

  describe('circuit-breaker parity (iter-38)', () => {
    it('syncMenuToPlatform bumps configService.recordError on adapter failure', async () => {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
        id: 'cfg-1',
        isEnabled: true,
        tenantId: 't1',
        platform: 'YEMEKSEPETI',
      });
      adapterFactory.getAdapter.mockReturnValue({
        syncMenu: jest.fn().mockRejectedValue(new Error('platform 500')),
      });
      authService.ensureValidToken.mockResolvedValue({ id: 'cfg-1' });
      (prisma.menuItemMapping.findMany as any).mockResolvedValue([]);

      await svc.syncMenuToPlatform('t1', 'YEMEKSEPETI');

      // Load-bearing: without this call, a platform that issues tokens
      // but rejects every menu sync would loop forever without
      // auto-disabling at CIRCUIT_BREAKER_THRESHOLD.
      expect(configService.recordError).toHaveBeenCalledWith(
        'cfg-1',
        expect.stringContaining('menu_sync:'),
      );
    });

    it('updateItemAvailability bumps configService.recordError on adapter failure', async () => {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
        id: 'cfg-1',
        isEnabled: true,
        tenantId: 't1',
        platform: 'YEMEKSEPETI',
      });
      adapterFactory.getAdapter.mockReturnValue({
        updateItemAvailability: jest.fn().mockRejectedValue(new Error('rate limited')),
      });
      authService.ensureValidToken.mockResolvedValue({ id: 'cfg-1' });

      await svc.updateItemAvailability('t1', 'YEMEKSEPETI', 'ext-1', false);

      expect(configService.recordError).toHaveBeenCalledWith(
        'cfg-1',
        expect.stringContaining('item_availability:'),
      );
    });

    it('does NOT call recordError on the happy path (counter only bumps on failure)', async () => {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue({
        id: 'cfg-1',
        isEnabled: true,
        tenantId: 't1',
        platform: 'YEMEKSEPETI',
      });
      adapterFactory.getAdapter.mockReturnValue({
        syncMenu: jest.fn().mockResolvedValue(undefined),
      });
      authService.ensureValidToken.mockResolvedValue({ id: 'cfg-1' });
      (prisma.menuItemMapping.findMany as any).mockResolvedValue([]);

      await svc.syncMenuToPlatform('t1', 'YEMEKSEPETI');

      expect(configService.recordError).not.toHaveBeenCalled();
    });
  });
});
