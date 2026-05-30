import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { PlanProjectorService } from './plan-projector.service';

/**
 * v2.8.89 — subscription-status-aware projection regression.
 *
 * Pre-v2.8.89 the projector read tenant.currentPlan directly and never
 * consulted Subscription.status. Lifecycle flows that flipped status
 * (cancel immediate / cancel-at-period-end / past-due → expired / PayTR
 * mid-settlement) without also flipping currentPlanId caused the
 * projector to KEEP re-writing the paid plan grants on every event,
 * leaking paid access until the nightly reconcile cron ran 24 h later.
 *
 * The new projector reads the active subscription row alongside the
 * tenant; if there is no ACTIVE/TRIALING row, it projects the FREE
 * plan regardless of where currentPlanId points. The lifecycle services
 * still update currentPlanId atomically (belt + suspenders), but a
 * forgotten update no longer leaks paid features.
 */
describe('PlanProjectorService.projectTenant — subscription-status-aware projection (v2.8.89)', () => {
  const TENANT = 'tenant-1';
  let prisma: MockPrismaClient;
  let entitlements: any;
  let svc: PlanProjectorService;

  const proPlan = {
    id: 'pro-plan',
    name: 'PRO',
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
    maxUsers: 15,
    maxTables: 50,
    maxProducts: 500,
    maxCategories: 50,
    maxMonthlyOrders: 5000,
  };

  const freePlan = {
    id: 'free-plan',
    name: 'FREE',
    advancedReports: false,
    multiLocation: false,
    customBranding: false,
    apiAccess: false,
    prioritySupport: false,
    inventoryTracking: false,
    kdsIntegration: true,
    reservationSystem: false,
    personnelManagement: false,
    deliveryIntegration: false,
    maxUsers: 2,
    maxTables: 5,
    maxProducts: 25,
    maxCategories: 5,
    maxMonthlyOrders: 100,
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    entitlements = {
      setGrantsForSourceTx: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn(),
    } as any;
    svc = new PlanProjectorService(prisma as any, entitlements);
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);
    (prisma.featureEntitlement.deleteMany as any).mockResolvedValue({ count: 0 });
    (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
  });

  it('projects PRO grants when subscription is ACTIVE', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      featureOverrides: null,
      limitOverrides: null,
      currentPlan: proPlan,
    } as any);
    (prisma.subscription.findFirst as any).mockResolvedValue({
      id: 'sub-1',
      status: 'ACTIVE',
    });

    await svc.projectTenant(TENANT);

    const [, , source, grants] = entitlements.setGrantsForSourceTx.mock.calls[0];
    expect(source).toBe('plan:PRO');
    expect(grants.some((g: any) => g.key === 'feature.multiLocation')).toBe(true);
    expect(grants.some((g: any) => g.key === 'feature.advancedReports')).toBe(true);
  });

  it('projects FREE grants when subscription is CANCELLED — even if currentPlanId still points at PRO', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      featureOverrides: null,
      limitOverrides: null,
      // The lifecycle service forgot to flip currentPlanId. Pre-v2.8.89
      // this would leak PRO grants. Post-v2.8.89 the projector still
      // catches it via the subscription-status check.
      currentPlan: proPlan,
    } as any);
    (prisma.subscription.findFirst as any).mockResolvedValue(null);
    prisma.subscriptionPlan.findUnique.mockResolvedValue(freePlan as any);

    await svc.projectTenant(TENANT);

    const [, , source, grants] = entitlements.setGrantsForSourceTx.mock.calls[0];
    expect(source).toBe('plan:FREE');
    // Paid features must not appear; FREE has none of these set true.
    expect(grants.some((g: any) => g.key === 'feature.multiLocation')).toBe(false);
    expect(grants.some((g: any) => g.key === 'feature.advancedReports')).toBe(false);
    // FREE's maxUsers is still surfaced — limits are projected from FREE,
    // so existing-tenant queries see 2/2 instead of 15/15.
    expect(grants.some((g: any) => g.key === 'limit.maxUsers' && g.value === 2)).toBe(true);
  });

  it('projects FREE grants when subscription is EXPIRED', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      featureOverrides: null,
      limitOverrides: null,
      currentPlan: proPlan,
    } as any);
    (prisma.subscription.findFirst as any).mockResolvedValue(null);
    prisma.subscriptionPlan.findUnique.mockResolvedValue(freePlan as any);

    await svc.projectTenant(TENANT);

    const [, , source] = entitlements.setGrantsForSourceTx.mock.calls[0];
    expect(source).toBe('plan:FREE');
  });

  it('caches the FREE plan lookup across consecutive projections (single subscriptionPlan.findUnique)', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      featureOverrides: null,
      limitOverrides: null,
      currentPlan: proPlan,
    } as any);
    (prisma.subscription.findFirst as any).mockResolvedValue(null);
    prisma.subscriptionPlan.findUnique.mockResolvedValue(freePlan as any);

    await svc.projectTenant(TENANT);
    await svc.projectTenant(TENANT);

    expect(prisma.subscriptionPlan.findUnique).toHaveBeenCalledTimes(1);
  });

  it('falls through to plan:NONE if subscription is non-paid AND FREE plan missing from catalog', async () => {
    // Degenerate state: the seed is broken / FREE was deleted.
    // Projector returns no plan grants rather than crashing the worker.
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      featureOverrides: null,
      limitOverrides: null,
      currentPlan: proPlan,
    } as any);
    (prisma.subscription.findFirst as any).mockResolvedValue(null);
    prisma.subscriptionPlan.findUnique.mockResolvedValue(null);

    await svc.projectTenant(TENANT);

    const [, , source, grants] = entitlements.setGrantsForSourceTx.mock.calls[0];
    expect(source).toBe('plan:NONE');
    expect(grants).toHaveLength(0);
  });
});
