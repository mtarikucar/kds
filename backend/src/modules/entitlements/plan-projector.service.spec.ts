import { PlanProjectorService } from './plan-projector.service';
import { EntitlementService } from './entitlement.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Behavior-level tests for the projector. We don't talk to a real database;
 * we set up enough Prisma mock returns to exercise the decision tree.
 *
 * What we verify:
 *  - Plan features get projected as `feature.*` grants under `plan:<NAME>`.
 *  - Plan limits (incl. -1 unlimited) get projected as `limit.*` grants.
 *  - Tenant.featureOverrides / limitOverrides project as `override:admin`
 *    with the __replace wrapper so the engine treats them as REPLACE.
 *  - Switching plan revokes the previous plan source.
 */
describe('PlanProjectorService.projectTenant', () => {
  let prisma: MockPrismaClient;
  let entitlements: jest.Mocked<EntitlementService>;
  let svc: PlanProjectorService;

  const TENANT = 'tenant-1';

  beforeEach(() => {
    prisma = mockPrismaClient();
    entitlements = {
      setGrantsForSource: jest.fn().mockResolvedValue(undefined),
      // Iter-76 — projectTenant now does its writes via setGrantsForSourceTx
      // inside a single $transaction so plan / override / addon writes
      // share one visibility window. Tests inspect this mock's calls
      // (args 1..3 are [tx, tenantId, source, grants]) the same way they
      // used to read setGrantsForSource.
      setGrantsForSourceTx: jest.fn().mockResolvedValue(undefined),
      revokeSource: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn(),
      getForTenant: jest.fn(),
      sweepExpired: jest.fn(),
    } as any;
    svc = new PlanProjectorService(prisma as any, entitlements);
    // Default: no active add-ons. Tests that need them override per-case.
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);
    // Default: stale-sources sweep is a no-op. The "switches plan" test
    // overrides this to assert the sweep + invalidate call happen.
    (prisma.featureEntitlement.deleteMany as any).mockResolvedValue({ count: 0 });
    // Pass the inner callback through with the prisma mock as the tx
    // client, so projectTenantInner's wrapping $transaction(async tx =>
    // ...) lets the inner findMany / deleteMany / setGrantsForSourceTx
    // calls still land on assertions below.
    (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
    // v2.8.89 — projectTenantInner now consults Subscription.status
    // before projecting the paid plan. Default: pretend the tenant has
    // an ACTIVE paid subscription so existing cases keep covering the
    // "project current plan" path. The new lifecycle-status case
    // overrides this to assert FREE fallback.
    (prisma.subscription.findFirst as any).mockResolvedValue({
      id: 'sub-1',
      status: 'ACTIVE',
    });
  });

  it('projects PRO plan features and limits as grants under plan:PRO', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      featureOverrides: null,
      limitOverrides: null,
      currentPlan: {
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
        maxMonthlyOrders: 2000,
      },
    } as any);
    prisma.featureEntitlement.findMany.mockResolvedValue([]);

    await svc.projectTenant(TENANT);

    // First call writes plan:PRO grants. Second call writes override:admin (empty).
    expect(entitlements.setGrantsForSourceTx).toHaveBeenCalledTimes(2);
    // setGrantsForSourceTx signature: (tx, tenantId, source, grants)
    const [, , source, grants] = entitlements.setGrantsForSourceTx.mock.calls[0];
    expect(source).toBe('plan:PRO');

    const featureKeys = grants.map((g) => g.key);
    // Disabled features (apiAccess) are NOT in the grant list — absence
    // means "not enabled" in the engine.
    expect(featureKeys).toContain('feature.advancedReports');
    expect(featureKeys).toContain('feature.kdsIntegration');
    expect(featureKeys).not.toContain('feature.apiAccess');
    expect(featureKeys).toContain('limit.maxUsers');
    expect(featureKeys).toContain('limit.maxMonthlyOrders');

    const limitMax = grants.find((g) => g.key === 'limit.maxUsers');
    expect(limitMax?.value).toBe(15);
  });

  it('projects BUSINESS unlimited (-1) limits faithfully', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      featureOverrides: null,
      limitOverrides: null,
      currentPlan: {
        name: 'BUSINESS',
        advancedReports: true,
        multiLocation: true,
        customBranding: true,
        apiAccess: true,
        prioritySupport: true,
        inventoryTracking: true,
        kdsIntegration: true,
        reservationSystem: true,
        personnelManagement: true,
        deliveryIntegration: true,
        maxUsers: -1,
        maxTables: -1,
        maxProducts: -1,
        maxCategories: -1,
        maxMonthlyOrders: -1,
      },
    } as any);
    prisma.featureEntitlement.findMany.mockResolvedValue([]);

    await svc.projectTenant(TENANT);

    // setGrantsForSourceTx args: (tx, tenantId, source, grants) → index 3
    const grants = entitlements.setGrantsForSourceTx.mock.calls[0][3];
    const max = grants.find((g: any) => g.key === 'limit.maxUsers');
    expect(max?.value).toBe(-1);
  });

  it('projects featureOverrides + limitOverrides as override:admin with REPLACE wrapper', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      featureOverrides: { customBranding: true, deliveryIntegration: false },
      limitOverrides: { maxTables: 80 },
      currentPlan: {
        name: 'BASIC',
        advancedReports: false,
        multiLocation: false,
        customBranding: false,
        apiAccess: false,
        prioritySupport: false,
        inventoryTracking: true,
        kdsIntegration: true,
        reservationSystem: false,
        personnelManagement: false,
        deliveryIntegration: false,
        maxUsers: 5,
        maxTables: 20,
        maxProducts: 100,
        maxCategories: 20,
        maxMonthlyOrders: 500,
      },
    } as any);
    prisma.featureEntitlement.findMany.mockResolvedValue([]);

    await svc.projectTenant(TENANT);

    // setGrantsForSourceTx signature: (tx, tenantId, source, grants)
    const [, , overrideSource, overrideGrants] = entitlements.setGrantsForSourceTx.mock.calls[1];
    expect(overrideSource).toBe('override:admin');

    const branding = overrideGrants.find((g: any) => g.key === 'feature.customBranding');
    expect(branding?.value).toEqual({ __replace: true });

    const delivery = overrideGrants.find((g: any) => g.key === 'feature.deliveryIntegration');
    expect(delivery?.value).toEqual({ __replace: false });

    const tables = overrideGrants.find((g: any) => g.key === 'limit.maxTables');
    expect(tables?.value).toEqual({ __replace: 80 });
  });

  it('revokes stale plan sources after a plan switch', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      featureOverrides: null,
      limitOverrides: null,
      currentPlan: {
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
        maxMonthlyOrders: 2000,
      },
    } as any);
    // Simulate that this tenant previously had a BASIC plan still tagged.
    // New behaviour: stale sources are wiped via a single deleteMany +
    // cache invalidate, not per-source revoke calls. The DELETE filter
    // matches anything `plan:*` except the current planSource, which is
    // exactly the right semantic.
    (prisma.featureEntitlement.deleteMany as any).mockResolvedValue({ count: 1 });

    await svc.projectTenant(TENANT);

    const deleteCalls = (prisma.featureEntitlement.deleteMany as any).mock.calls;
    const staleSweep = deleteCalls.find((c: any) =>
      c[0]?.where?.source?.startsWith === 'plan:' && c[0]?.where?.source?.not === 'plan:PRO',
    );
    expect(staleSweep).toBeDefined();
    expect(entitlements.invalidate).toHaveBeenCalledWith(TENANT);
  });

  it('treats a tenant with no current plan as plan:NONE and writes no plan grants', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      featureOverrides: null,
      limitOverrides: null,
      currentPlan: null,
    } as any);
    prisma.featureEntitlement.findMany.mockResolvedValue([]);

    await svc.projectTenant(TENANT);

    // setGrantsForSourceTx signature: (tx, tenantId, source, grants)
    const [, , source, grants] = entitlements.setGrantsForSourceTx.mock.calls[0];
    expect(source).toBe('plan:NONE');
    expect(grants).toHaveLength(0);
  });

  // Drift guard (iter-24): the projector reads a hardcoded list of
  // SubscriptionPlan columns at FEATURE_COLUMNS / LIMIT_COLUMNS. If the
  // Prisma schema gains a new feature flag (`Boolean @default(false)`)
  // or limit (`Int @default(...)`) without the dev also adding it to
  // the projector list, no test fails — the new column just silently
  // never lands in the entitlement table. This test pins the expected
  // column set so any schema-side addition is a deliberate, two-file
  // change (schema + this list).
  it('FEATURE_COLUMNS / LIMIT_COLUMNS match the SubscriptionPlan model snapshot (iter-24)', () => {
    // Snapshot of SubscriptionPlan's feature-flag Boolean columns as of
    // 2026-05-28. Update this list AND the projector's FEATURE_COLUMNS
    // whenever a new flag column is added to schema.prisma so the
    // entitlement engine starts surfacing it.
    const EXPECTED_FEATURES = [
      'advancedReports',
      'multiLocation',
      'customBranding',
      'apiAccess',
      'prioritySupport',
      'inventoryTracking',
      'kdsIntegration',
      'reservationSystem',
      'personnelManagement',
      'deliveryIntegration',
      // v3.0.0 — POS access tier-gate (BASIC+). FREE plans get
      // posAccess=false, every other tier gets true; projector mirrors
      // the column verbatim so PlanFeatureGuard can read it.
      'posAccess',
    ];
    // Same intent for numeric limit columns.
    const EXPECTED_LIMITS = [
      'maxUsers',
      'maxTables',
      // v3.0.0 — branch cap. FREE/BASIC=1, PRO=3, BUSINESS=-1.
      // extra_branch add-on SUMs onto this via the engine fold.
      'maxBranches',
      'maxProducts',
      'maxCategories',
      'maxMonthlyOrders',
    ];
    // `as any` to reach the private static — guard is a test-only escape.
    expect((PlanProjectorService as any).FEATURE_COLUMNS).toEqual(EXPECTED_FEATURES);
    expect((PlanProjectorService as any).LIMIT_COLUMNS).toEqual(EXPECTED_LIMITS);
  });
});
