import { NotFoundException } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

/**
 * v2.8.88 — getEffectiveFeatures engine-routing regression.
 *
 * Pre-v2.8.88 the endpoint read `tenant.currentPlan + featureOverrides
 * + limitOverrides` and never touched the entitlement engine. A tenant
 * who bought `integration_yemeksepeti` (₺249/mo) got NOTHING visible
 * in their UI — the engine row sat in the DB unread by the UI's
 * single source of feature truth.
 *
 * Post-v2.8.88 the method routes through
 * `EntitlementService.getForTenant()` and translates the engine's
 * dotted keys (`feature.X` / `limit.Y` / `integration.Z`) into the
 * flat camelCase shape the frontend already consumes. Response gains
 * an `integrations` field (additive).
 *
 * Three cases pinned here:
 *   1. Plan + add-on grants flow through: a tenant whose engine carries
 *      `integration.delivery: ['yemeksepeti']` from a TenantAddOn now
 *      sees that vendor in the response.
 *   2. Capacity add-on (`extra_branch ×3`) summed by the engine
 *      surfaces as `limits.branches: planMax + 3`.
 *   3. Engine empty (new tenant / projector race) → plan-only
 *      fallback so the UI still renders.
 */
describe('SubscriptionService.getEffectiveFeatures (v2.8.88)', () => {
  let prisma: any;
  let entitlements: any;
  let svc: SubscriptionService;

  const tenantId = 't-1';

  function planRow(overrides: any = {}) {
    return {
      id: 'plan-pro',
      name: 'PRO',
      displayName: 'Pro',
      advancedReports: true,
      multiLocation: true,
      customBranding: true,
      apiAccess: false,
      prioritySupport: true,
      inventoryTracking: true,
      kdsIntegration: true,
      reservationSystem: true,
      personnelManagement: true,
      deliveryIntegration: true,
      posAccess: true,
      maxUsers: 15,
      maxTables: 50,
      maxBranches: 3,
      maxProducts: 500,
      maxCategories: 50,
      maxMonthlyOrders: 5000,
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma = {
      tenant: {
        findUnique: jest.fn(),
      },
      subscriptionPlan: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      // v2.8.90: the engine-empty fallback now reads active TenantAddOn
      // rows so add-on grants survive a projector race. Default: no
      // add-ons (plan-only fallback). The new "adds an add-on" case
      // overrides this mock.
      tenantAddOn: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    entitlements = {
      getForTenant: jest.fn(),
    };
    svc = new SubscriptionService(
      prisma,
      {} as any,
      {} as any,
      { append: jest.fn() } as any,
      entitlements,
    );
  });

  it('1) routes through the engine and surfaces an integration grant from a TenantAddOn', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      currentPlan: planRow(),
      usedTrialPlanIds: [],
      featureOverrides: null,
      limitOverrides: null,
    });
    entitlements.getForTenant.mockResolvedValue({
      features: {
        'feature.advancedReports': true,
        'feature.multiLocation': true,
        'feature.deliveryIntegration': true,
      },
      limits: {
        'limit.maxUsers': 15,
        'limit.maxTables': 50,
        'limit.maxProducts': 500,
      },
      integrations: {
        // The add-on grant the legacy method ignored. Now flows through.
        'integration.delivery': ['yemeksepeti'],
      },
      computedAt: new Date().toISOString(),
    });

    const result = await svc.getEffectiveFeatures(tenantId);

    expect(result.features.deliveryIntegration).toBe(true);
    expect(result.integrations).toEqual({ delivery: ['yemeksepeti'] });
    expect(result.limits.maxUsers).toBe(15);
  });

  it('2) sums a capacity add-on into the limit response (extra_branch ×3 → branches = base + 3)', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      currentPlan: planRow({ maxUsers: 15 }),
      usedTrialPlanIds: [],
      featureOverrides: null,
      limitOverrides: null,
    });
    entitlements.getForTenant.mockResolvedValue({
      features: { 'feature.multiLocation': true },
      limits: {
        'limit.maxUsers': 15,
        // Engine already summed plan.maxBranches (implicit 1) + 3
        // capacity grants from `extra_branch` purchases.
        'limit.maxBranches': 4,
      },
      integrations: {},
      computedAt: new Date().toISOString(),
    });

    const result = await svc.getEffectiveFeatures(tenantId);

    // Engine path returns `limits` as a Record<string, number>; cast for
    // the dynamic key. (Since v3.0.7 the fallback path carries maxBranches
    // too — pinned by the engine-empty test below.)
    expect((result.limits as Record<string, number>).maxBranches).toBe(4);
    expect(result.features.multiLocation).toBe(true);
  });

  it('3) engine empty → plan-only fallback (paranoid path for projector race)', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      currentPlan: planRow({ multiLocation: false, advancedReports: false }),
      usedTrialPlanIds: [],
      featureOverrides: null,
      limitOverrides: null,
    });
    entitlements.getForTenant.mockResolvedValue({
      features: {},
      limits: {},
      integrations: {},
      computedAt: new Date(0).toISOString(),
    });

    const result = await svc.getEffectiveFeatures(tenantId);

    // Fallback walks plan + overrides — must still produce the
    // canonical response shape so the frontend has something to render.
    expect(result.features.multiLocation).toBe(false);
    expect(result.features.advancedReports).toBe(false);
    expect(result.limits.maxUsers).toBe(15);
    expect(result.integrations).toEqual({});
    // v3.0.7 regression — posAccess + maxBranches must survive the engine-empty
    // fallback. They were omitted from the fallback's hardcoded lists (added to
    // the projector in v3.0.0 but not mirrored here), so a fresh BUSINESS tenant
    // whose projector hadn't run resolved posAccess=undefined → the POS UI and
    // sidebar item were hidden. Pins the fallback to the projector's columns.
    expect(result.features.posAccess).toBe(true);
    expect((result.limits as Record<string, number>).maxBranches).toBe(3);
  });

  it('throws NotFound when tenant has no plan (preserved from legacy behavior)', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);
    await expect(svc.getEffectiveFeatures(tenantId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('feature overrides win on the fallback path (admin force-grant scenario)', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      currentPlan: planRow({ apiAccess: false }),
      usedTrialPlanIds: [],
      featureOverrides: { apiAccess: true }, // admin-granted
      limitOverrides: null,
    });
    entitlements.getForTenant.mockResolvedValue({
      features: {},
      limits: {},
      integrations: {},
      computedAt: new Date(0).toISOString(),
    });

    const result = await svc.getEffectiveFeatures(tenantId);
    expect(result.features.apiAccess).toBe(true);
  });

  it('trialEligiblePlanIds excludes already-used trial plans', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      currentPlan: planRow(),
      usedTrialPlanIds: ['plan-pro'],
      featureOverrides: null,
      limitOverrides: null,
    });
    prisma.subscriptionPlan.findMany.mockResolvedValue([
      { id: 'plan-basic', trialDays: 14 },
      { id: 'plan-pro', trialDays: 14 },
      { id: 'plan-business', trialDays: 14 },
    ]);
    entitlements.getForTenant.mockResolvedValue({
      features: { 'feature.multiLocation': true },
      limits: {},
      integrations: {},
      computedAt: new Date().toISOString(),
    });

    const result = await svc.getEffectiveFeatures(tenantId);
    expect(result.trialEligiblePlanIds).toEqual(['plan-basic', 'plan-business']);
  });
});
