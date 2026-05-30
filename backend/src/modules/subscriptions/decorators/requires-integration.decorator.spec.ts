import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlanFeatureGuard } from '../guards/plan-feature.guard';
import { REQUIRED_INTEGRATIONS_KEY } from './requires-integration.decorator';
import { REQUIRED_PLANS_KEY } from './requires-plan.decorator';
import { REQUIRED_FEATURES_KEY } from './requires-feature.decorator';
import { CHECK_LIMIT_KEY } from './check-limit.decorator';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';

/**
 * v2.8.88 — @RequiresIntegration guard branch regression.
 *
 * Behaviour:
 *   - Tenant whose engine carries `integration.<domain>: [...vendor]`
 *     passes (any non-empty array unlocks).
 *   - Tenant without the grant (empty list / missing key) hits 403
 *     with a friendly "buy from the marketplace" message.
 *   - Multiple domains are AND'd.
 *   - @Public skips the entire guard.
 */
describe('PlanFeatureGuard @RequiresIntegration branch (v2.8.88)', () => {
  let guard: PlanFeatureGuard;
  let reflector: Reflector;
  let prisma: any;
  let entitlements: any;

  function ctx(handlerMeta: Record<string, unknown>, classMeta: Record<string, unknown> = {}) {
    return {
      getHandler: () => ({ __meta: handlerMeta }),
      getClass: () => ({ __meta: classMeta }),
      switchToHttp: () => ({
        getRequest: () => ({ user: { tenantId: 't-1' } }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = new Reflector();
    // Stub getAllAndOverride: read the metadata from our test ctx
    // markers + map by reflector key.
    (reflector.getAllAndOverride as any) = jest.fn((key: string, targets: any[]) => {
      for (const t of targets) {
        if (t?.__meta && key in t.__meta) return t.__meta[key];
      }
      return undefined;
    });
    prisma = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 't-1',
          currentPlan: { name: 'PRO', displayName: 'Pro' },
          featureOverrides: null,
          limitOverrides: null,
        }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
      },
    };
    entitlements = { getForTenant: jest.fn() };
    guard = new PlanFeatureGuard(reflector, prisma as any, entitlements as any);
  });

  it('allows the request when the integration domain has at least one vendor', async () => {
    entitlements.getForTenant.mockResolvedValue({
      features: { 'feature.deliveryIntegration': true },
      limits: {},
      integrations: { 'integration.delivery': ['yemeksepeti'] },
      computedAt: new Date().toISOString(),
    });
    const c = ctx({ [REQUIRED_INTEGRATIONS_KEY]: ['delivery'] });
    await expect(guard.canActivate(c)).resolves.toBe(true);
  });

  it('rejects with a marketplace-pointer message when the domain is missing', async () => {
    entitlements.getForTenant.mockResolvedValue({
      features: { 'feature.deliveryIntegration': true },
      limits: {},
      integrations: {}, // no grants
      computedAt: new Date().toISOString(),
    });
    const c = ctx({ [REQUIRED_INTEGRATIONS_KEY]: ['delivery'] });
    await expect(guard.canActivate(c)).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await guard.canActivate(c);
    } catch (e: any) {
      expect(e.message).toMatch(/delivery/);
      expect(e.message).toMatch(/marketplace/);
    }
  });

  it('rejects when the domain key exists but the vendor list is empty', async () => {
    entitlements.getForTenant.mockResolvedValue({
      features: {},
      limits: {},
      integrations: { 'integration.delivery': [] }, // degenerate state
      computedAt: new Date().toISOString(),
    });
    const c = ctx({ [REQUIRED_INTEGRATIONS_KEY]: ['delivery'] });
    await expect(guard.canActivate(c)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('AND-s multiple domains — both must be present', async () => {
    entitlements.getForTenant.mockResolvedValue({
      features: {},
      limits: {},
      integrations: { 'integration.delivery': ['yemeksepeti'] }, // only one
      computedAt: new Date().toISOString(),
    });
    const c = ctx({ [REQUIRED_INTEGRATIONS_KEY]: ['delivery', 'fiscal'] });
    await expect(guard.canActivate(c)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('@Public skips the guard entirely (no engine call)', async () => {
    const c = ctx({ [IS_PUBLIC_KEY]: true, [REQUIRED_INTEGRATIONS_KEY]: ['delivery'] });
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(entitlements.getForTenant).not.toHaveBeenCalled();
  });
});
