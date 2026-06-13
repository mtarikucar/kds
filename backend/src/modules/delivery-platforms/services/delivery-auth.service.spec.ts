import { DeliveryAuthService } from './delivery-auth.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';
import { PlatformLogAction } from '../constants/platform.enum';

/**
 * Behaviour locks for token lifecycle:
 *
 *  - refreshToken: authenticates via the platform's OWN adapter, persists
 *    the token through configService.updateToken (which encrypts), logs
 *    success; on failure bumps recordError (circuit-breaker) + logs
 *    failure and never throws.
 *  - Disabled / missing configs are skipped (no adapter, no auth attempt).
 *  - refreshExpiringTokens sweeps only enabled configs whose token expires
 *    within the 10-minute window and refreshes each.
 *  - ensureValidToken: returns the cached config WITHOUT refreshing while
 *    the token has >2min of life; refreshes (then re-reads) when expired,
 *    near-expiry, or missing.
 */
describe('DeliveryAuthService', () => {
  let prisma: MockPrismaClient;
  let adapterFactory: any;
  let adapter: any;
  let configService: any;
  let logService: any;
  let svc: DeliveryAuthService;

  const ENABLED = (over: any = {}) => ({
    id: 'cfg-1', isEnabled: true, platform: 'TRENDYOL', tenantId: 't1', ...over,
  });

  beforeEach(() => {
    prisma = mockPrismaClient();
    adapter = {
      authenticate: jest.fn().mockResolvedValue({ token: 'tok-x', expiresAt: new Date('2030-01-01') }),
    };
    adapterFactory = { getAdapter: jest.fn().mockReturnValue(adapter) };
    configService = {
      updateToken: jest.fn().mockResolvedValue({}),
      recordError: jest.fn().mockResolvedValue({}),
    };
    logService = { log: jest.fn().mockResolvedValue(undefined) };
    svc = new DeliveryAuthService(prisma as any, adapterFactory, configService, logService);
  });

  describe('refreshToken', () => {
    it('authenticates via the platform-specific adapter and persists the token through configService.updateToken', async () => {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue(ENABLED());

      await svc.refreshToken('cfg-1');

      // Provider selection keyed on the config's own platform.
      expect(adapterFactory.getAdapter).toHaveBeenCalledWith('TRENDYOL');
      expect(adapter.authenticate).toHaveBeenCalled();
      // Token persisted (encryption happens inside the real updateToken).
      expect(configService.updateToken).toHaveBeenCalledWith('cfg-1', 'tok-x', new Date('2030-01-01'));
      // Success audit logged, circuit-breaker untouched.
      expect(logService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: PlatformLogAction.AUTH_REFRESH, success: true }),
      );
      expect(configService.recordError).not.toHaveBeenCalled();
    });

    it('skips disabled configs entirely (no adapter, no auth)', async () => {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue(ENABLED({ isEnabled: false }));

      await svc.refreshToken('cfg-1');

      expect(adapterFactory.getAdapter).not.toHaveBeenCalled();
      expect(configService.updateToken).not.toHaveBeenCalled();
    });

    it('is a no-op for a missing config', async () => {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue(null);

      await svc.refreshToken('cfg-1');

      expect(adapter.authenticate).not.toHaveBeenCalled();
    });

    it('on auth failure bumps the circuit-breaker, logs failure, and does not throw', async () => {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue(ENABLED());
      adapter.authenticate.mockRejectedValue(new Error('401 unauthorized'));

      await expect(svc.refreshToken('cfg-1')).resolves.toBeUndefined();

      expect(configService.recordError).toHaveBeenCalledWith('cfg-1', '401 unauthorized');
      expect(configService.updateToken).not.toHaveBeenCalled();
      expect(logService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: PlatformLogAction.AUTH_REFRESH,
          success: false,
          error: '401 unauthorized',
        }),
      );
    });
  });

  describe('refreshExpiringTokens', () => {
    it('refreshes every enabled config inside the 10-minute window and returns the count', async () => {
      (prisma.deliveryPlatformConfig.findMany as any).mockResolvedValue([
        ENABLED({ id: 'cfg-1' }),
        ENABLED({ id: 'cfg-2', platform: 'GETIR' }),
      ]);
      // refreshToken re-reads each config by id.
      (prisma.deliveryPlatformConfig.findUnique as any)
        .mockImplementation(async ({ where }: any) => ENABLED({ id: where.id }));

      const count = await svc.refreshExpiringTokens();

      expect(count).toBe(2);
      const sweepWhere = (prisma.deliveryPlatformConfig.findMany as any).mock.calls[0][0].where;
      expect(sweepWhere.isEnabled).toBe(true);
      expect(sweepWhere.tokenExpiresAt.lte).toBeInstanceOf(Date);
      expect(adapter.authenticate).toHaveBeenCalledTimes(2);
    });
  });

  describe('ensureValidToken caching', () => {
    it('returns the cached config WITHOUT refreshing when the token has >2min of life', async () => {
      const farFuture = new Date(Date.now() + 60 * 60 * 1000);
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue(
        ENABLED({ accessToken: 'v1:cached', tokenExpiresAt: farFuture }),
      );

      const out: any = await svc.ensureValidToken('cfg-1');

      expect(out.accessToken).toBe('v1:cached');
      expect(adapter.authenticate).not.toHaveBeenCalled();
      // Only the single read — no refresh, no re-read.
      expect((prisma.deliveryPlatformConfig.findUnique as any).mock.calls).toHaveLength(1);
    });

    it('refreshes then re-reads when the token is near expiry (<2min left)', async () => {
      const nearExpiry = new Date(Date.now() + 60 * 1000); // 1 min left
      (prisma.deliveryPlatformConfig.findUnique as any)
        .mockResolvedValueOnce(ENABLED({ accessToken: 'v1:stale', tokenExpiresAt: nearExpiry }))
        .mockResolvedValueOnce(ENABLED({ accessToken: 'v1:stale', tokenExpiresAt: nearExpiry })) // inside refreshToken
        .mockResolvedValueOnce(ENABLED({ accessToken: 'v1:fresh' })); // final re-read

      const out: any = await svc.ensureValidToken('cfg-1');

      expect(adapter.authenticate).toHaveBeenCalledTimes(1);
      expect(out.accessToken).toBe('v1:fresh');
    });

    it('refreshes when there is no cached token at all', async () => {
      (prisma.deliveryPlatformConfig.findUnique as any)
        .mockResolvedValueOnce(ENABLED({ accessToken: null, tokenExpiresAt: null }))
        .mockResolvedValueOnce(ENABLED({ accessToken: null, tokenExpiresAt: null })) // inside refreshToken
        .mockResolvedValueOnce(ENABLED({ accessToken: 'v1:fresh' }));

      await svc.ensureValidToken('cfg-1');

      expect(adapter.authenticate).toHaveBeenCalledTimes(1);
    });

    it('returns null for a missing config', async () => {
      (prisma.deliveryPlatformConfig.findUnique as any).mockResolvedValue(null);

      const out = await svc.ensureValidToken('cfg-1');

      expect(out).toBeNull();
      expect(adapter.authenticate).not.toHaveBeenCalled();
    });
  });
});
