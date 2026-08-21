import { Test, TestingModule } from '@nestjs/testing';
import { DemoService } from './demo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanProjectorService } from '../entitlements/plan-projector.service';
import { TenantMarketplaceService } from '../marketplace/tenant-marketplace.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';

// Drift tripwire (see plan-projector.service.spec.ts's baseline snapshot
// pin): the demo plan's `subscriptionPlan.upsert` create block hand-mirrors
// every SubscriptionPlan.LIMIT_COLUMNS entry as a generous top-tier value.
// Reaches the same private static via the same `as any` escape hatch used
// throughout plan-projector.service.spec.ts / plan-mapper-parity.spec.ts.


/**
 * Guards the self-contained demo environment:
 *  - ensureDemoTenant SHORT-CIRCUITS when the demo admin already exists (no
 *    re-seed, so concurrent demo-session requests don't duplicate the tenant).
 *  - a cold ensureDemoTenant seeds the full showcase (plan/tenant/branch/
 *    subscription/admin + menu/tables/orders).
 *  - resetDemoData is a no-op before the demo exists (lazy seed contract).
 */
describe('DemoService', () => {
  let service: DemoService;
  let prisma: MockPrismaClient;
  let projector: { projectTenant: jest.Mock };
  let tenantMarketplace: { purchase: jest.Mock };

  beforeEach(async () => {
    prisma = mockPrismaClient();
    projector = { projectTenant: jest.fn().mockResolvedValue(undefined) };
    tenantMarketplace = { purchase: jest.fn().mockResolvedValue({ id: 'ta-x' }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DemoService,
        { provide: PrismaService, useValue: prisma },
        { provide: PlanProjectorService, useValue: projector },
        { provide: TenantMarketplaceService, useValue: tenantMarketplace },
      ],
    }).compile();
    service = module.get(DemoService);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'debug').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    // Reconcile reads these on every entry; default to "already correct" so
    // only the tests that care about repair have to arrange it.
    (prisma.marketplaceAddOn.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.tenantAddOn.findMany as jest.Mock).mockResolvedValue([]);
    // resetDemoData now runs under a Postgres advisory lock (multi-replica
    // guard). Grant it by default so the body runs; a dedicated test overrides
    // this to assert the lock actually gates the destructive wipe.
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([{ locked: true }]);
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      typeof cb === "function" ? cb(prisma) : Promise.all(cb),
    );
  });

  it('short-circuits to the existing demo admin without re-seeding', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue({
      id: 'demo-admin',
      email: DemoService.ADMIN_EMAIL,
      firstName: 'Demo',
      lastName: 'Yönetici',
      role: 'ADMIN',
      tenantId: 'demo-tenant',
      phone: '+905550000000',
      locale: 'tr',
    });

    const admin = await service.ensureDemoTenant();

    expect(admin.id).toBe('demo-admin');
    // No seeding happened.
    expect(prisma.tenant.upsert).not.toHaveBeenCalled();
    expect(prisma.subscriptionPlan.upsert).not.toHaveBeenCalled();
  });

  it('seeds the full demo on a cold start (plan, tenant, branch, sub, admin, content)', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.subscriptionPlan.upsert as jest.Mock).mockResolvedValue({ id: 'plan-demo' });
    (prisma.tenant.upsert as jest.Mock).mockResolvedValue({
      id: 'tenant-demo',
      subdomain: 'demo-explore',
    });
    (prisma.branch.upsert as jest.Mock).mockResolvedValue({ id: 'branch-demo' });
    (prisma.subscription.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.subscription.create as jest.Mock).mockResolvedValue({ id: 'sub-demo' });
    (prisma.user.upsert as jest.Mock).mockResolvedValue({
      id: 'admin-demo',
      email: DemoService.ADMIN_EMAIL,
      firstName: 'Demo',
      lastName: 'Yönetici',
      role: 'ADMIN',
      tenantId: 'tenant-demo',
      phone: '+905550000000',
      locale: null,
    });
    (prisma.category.count as jest.Mock).mockResolvedValue(0);
    let cat = 0;
    (prisma.category.create as jest.Mock).mockImplementation(() =>
      Promise.resolve({ id: `cat-${cat++}` }),
    );
    let prod = 0;
    (prisma.product.create as jest.Mock).mockImplementation(() =>
      Promise.resolve({ id: `prod-${prod++}`, price: 100, name: `p${prod}` }),
    );
    let tbl = 0;
    (prisma.table.create as jest.Mock).mockImplementation(() =>
      Promise.resolve({ id: `tbl-${tbl++}`, number: String(tbl) }),
    );
    (prisma.order.create as jest.Mock).mockResolvedValue({ id: 'order-demo' });

    const admin = await service.ensureDemoTenant();

    expect(admin.id).toBe('admin-demo');
    // The demo plan is internal: never active/public.
    const planArgs = (prisma.subscriptionPlan.upsert as jest.Mock).mock.calls[0][0];
    expect(planArgs.create.isActive).toBe(false);
    expect(planArgs.create.isPublic).toBe(false);
    // Drift fix (DRIFT-4): aiContentGeneration must be granted AND the AI
    // quota must be discoverable (non-zero) — pre-fix the flag was true but
    // the schema-default 0 quota silently blocked the AI menu studio.
    expect(planArgs.create.aiContentGeneration).toBe(true);
    expect(planArgs.create.maxMonthlyAiPhotos).toBeGreaterThan(0);
    expect(planArgs.create.maxMonthlyAiVideos).toBeGreaterThan(0);
    expect(planArgs.create.maxMonthlyAi3dModels).toBeGreaterThan(0);
    // v3.3.0 tripwire, re-pointed. The old one pinned that every
    // SubscriptionPlan limit column was set explicitly, because a forgotten
    // column silently fell through to the Prisma default (maxBranches did
    // exactly that, capping the demo at one branch while the multiLocation
    // feature read as granted). Plans no longer decide anything, so what
    // matters now is that the demo GRANTS every paid capability — otherwise a
    // screen quietly disappears from the tour and nobody notices.
    const overrides = (prisma.tenant.upsert as jest.Mock).mock.calls[0][0]
      .create.featureOverrides;
    for (const paid of [
      "license",
      "advancedReports",
      "inventoryTracking",
      "reservationSystem",
      "personnelManagement",
      "aiContentGeneration",
      "apiAccess",
      "externalDisplay",
      "prioritySupport",
      "deliveryIntegration",
    ]) {
      expect(overrides[paid]).toEqual({ mode: "grant" });
    }
    // And that it uses GRANT mode throughout: a `false`/suppress entry
    // projects `{__replace:false}`, which is the poison pill that
    // permanently blocks a feature even after it is legitimately bought.
    for (const value of Object.values(overrides as Record<string, unknown>)) {
      expect(value).toEqual({ mode: "grant" });
    }

    // Idempotent: tenant/branch/admin go through upsert on their unique keys so
    // a pre-existing/partial demo never collides on the subdomain.
    const tenantArgs = (prisma.tenant.upsert as jest.Mock).mock.calls[0][0];
    expect(tenantArgs.where.subdomain).toBe('demo-explore');
    // The demo tenant is Turkish — written EXPLICITLY on the create block
    // (not left to the schema default) so the intent is visible, matching
    // every other tenant-creating path in the codebase.
    expect(tenantArgs.create.countryCode).toBe('TR');
    expect(tenantArgs.create.currency).toBe('TRY');
    expect(prisma.tenant.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.branch.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.create).toHaveBeenCalledTimes(1);
    // Showcase content seeded.
    expect((prisma.category.create as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect((prisma.product.create as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect((prisma.table.create as jest.Mock).mock.calls.length).toBe(8);
    expect((prisma.order.create as jest.Mock).mock.calls.length).toBe(6);
  });

  it('self-heals a partial prior seed without re-creating the tenant or content', async () => {
    // No admin yet (e.g. a prior run created the tenant then threw), but the
    // tenant + a subscription + menu already exist.
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.subscriptionPlan.upsert as jest.Mock).mockResolvedValue({ id: 'plan-demo' });
    (prisma.tenant.upsert as jest.Mock).mockResolvedValue({
      id: 'tenant-demo',
      subdomain: 'demo-explore',
    });
    (prisma.branch.upsert as jest.Mock).mockResolvedValue({ id: 'branch-demo' });
    (prisma.subscription.findFirst as jest.Mock).mockResolvedValue({ id: 'sub-existing' });
    (prisma.user.upsert as jest.Mock).mockResolvedValue({
      id: 'admin-demo',
      email: DemoService.ADMIN_EMAIL,
      firstName: 'Demo',
      lastName: 'Yönetici',
      role: 'ADMIN',
      tenantId: 'tenant-demo',
      phone: '+905550000000',
      locale: null,
    });
    (prisma.category.count as jest.Mock).mockResolvedValue(5);

    const admin = await service.ensureDemoTenant();

    expect(admin.id).toBe('admin-demo');
    // Tenant upsert is a no-op (existing) — no second subscription, no dup menu.
    expect(prisma.subscription.create).not.toHaveBeenCalled();
    expect(prisma.category.create).not.toHaveBeenCalled();
    expect(prisma.table.create).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('resetDemoData is a no-op before the demo tenant exists', async () => {
    (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(null);
    await service.resetDemoData();
    // v2 advisory lock itself opens a $transaction, so assert on the
    // destructive writes instead of the transaction wrapper.
    expect(prisma.order.deleteMany).not.toHaveBeenCalled();
  });

  it('resetDemoData skips the destructive wipe when the advisory lock is held by another replica', async () => {
    // Another replica already holds the lock this tick.
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValue([{ locked: false }]);
    await service.resetDemoData();
    // The body never ran: no tenant lookup, no wipe. ($transaction itself
    // fires once as the v2 lock holder — assert on the body's calls.)
    expect(prisma.tenant.findFirst).not.toHaveBeenCalled();
    expect(prisma.order.deleteMany).not.toHaveBeenCalled();
  });

  describe('entitlement repair on every entry', () => {
    // THE BUG THIS PINS: ensureDemoTenant used to return the moment the demo
    // admin existed, so grants were written once, at first seed. The v3.3.0
    // free_core migration then cleared Tenant.featureOverrides for EVERY
    // tenant — demo included — and nothing wrote them back. The demo silently
    // fell to the free core: no reports, reservations, personnel, stock, AI or
    // API, and the settings nav quietly went short. Nobody noticed until a
    // human did.
    const existingAdmin = {
      id: 'demo-admin',
      email: DemoService.ADMIN_EMAIL,
      firstName: 'Demo',
      lastName: 'Yönetici',
      role: 'ADMIN',
      tenantId: 'demo-tenant',
      phone: '+905550000000',
      locale: 'tr',
    };

    beforeEach(() => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(existingAdmin);
    });

    it('restores feature overrides a data migration wiped', async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        featureOverrides: null,
      });

      await service.ensureDemoTenant();

      const written = (prisma.tenant.update as jest.Mock).mock.calls[0][0].data
        .featureOverrides;
      expect(written.advancedReports).toEqual({ mode: 'grant' });
      expect(written.reservationSystem).toEqual({ mode: 'grant' });
      expect(written.aiContentGeneration).toEqual({ mode: 'grant' });
      // …and the tenant is re-projected, or the repair would sit in the DB
      // without reaching the entitlement engine.
      expect(projector.projectTenant).toHaveBeenCalledWith('demo-tenant');
    });

    it('leaves a healthy demo alone', async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        featureOverrides: Object.fromEntries(
          Object.keys((DemoService as any).ALL_FEATURES).map((k) => [
            k,
            { mode: 'grant' },
          ]),
        ),
      });

      await service.ensureDemoTenant();

      expect(prisma.tenant.update).not.toHaveBeenCalled();
      expect(projector.projectTenant).not.toHaveBeenCalled();
    });

    it('grants integrations as owned products, which overrides cannot express', async () => {
      // The projector writes `feature.${key}` for every override entry, so an
      // integration grant has no route through that map at all. SMS settings,
      // e-Belge/ÖKC and caller-ID were therefore unreachable in the demo even
      // before the migration.
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        featureOverrides: Object.fromEntries(
          Object.keys((DemoService as any).ALL_FEATURES).map((k) => [
            k,
            { mode: 'grant' },
          ]),
        ),
      });
      (prisma.marketplaceAddOn.findMany as jest.Mock).mockResolvedValue([
        { id: 'p-lic', code: 'license_annual', kind: 'license' },
        { id: 'p-sms', code: 'sms_integration', kind: 'integration' },
      ]);
      (prisma.tenantAddOn.findMany as jest.Mock).mockResolvedValue([]);

      await service.ensureDemoTenant();

      // Through purchase(), NOT a raw insert: that path stamps the
      // anniversary anchor. Writing rows directly left the demo holding a live
      // licence with no anchor, the snapshot reported "none", and the store
      // added a SECOND licence to every basket — which checkout refused,
      // failing the whole purchase.
      const codes = tenantMarketplace.purchase.mock.calls.map((c) => c[1].addOnCode);
      expect(codes.sort()).toEqual(['license_annual', 'sms_integration']);
      expect(tenantMarketplace.purchase.mock.calls[0][3]).toMatchObject({
        comp: expect.objectContaining({ reason: expect.any(String) }),
      });
      expect(projector.projectTenant).toHaveBeenCalledWith('demo-tenant');
    });

    it('comps the LICENCE too, or every integration it grants stays dark', async () => {
      // The projector suppresses a requiresLicense product while no LICENCE
      // PRODUCT is owned — a feature.license override does not satisfy it,
      // because the check reads ownership rows.
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        featureOverrides: { license: { mode: 'grant' } },
      });
      (prisma.marketplaceAddOn.findMany as jest.Mock).mockResolvedValue([
        { id: 'p-lic', code: 'license_annual', kind: 'license' },
      ]);
      (prisma.tenantAddOn.findMany as jest.Mock).mockResolvedValue([]);

      await service.ensureDemoTenant();

      const where = (prisma.marketplaceAddOn.findMany as jest.Mock).mock
        .calls[0][0].where;
      expect(where.OR).toEqual(
        expect.arrayContaining([{ kind: 'license' }, { kind: 'integration' }]),
      );
    });

    it('does not re-comp what the demo already owns', async () => {
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        featureOverrides: Object.fromEntries(
          Object.keys((DemoService as any).ALL_FEATURES).map((k) => [
            k,
            { mode: 'grant' },
          ]),
        ),
      });
      (prisma.marketplaceAddOn.findMany as jest.Mock).mockResolvedValue([
        { id: 'p-lic', code: 'license_annual', kind: 'license' },
      ]);
      (prisma.tenantAddOn.findMany as jest.Mock).mockResolvedValue([
        { addOnId: 'p-lic' },
      ]);

      await service.ensureDemoTenant();

      expect(tenantMarketplace.purchase).not.toHaveBeenCalled();
      expect(projector.projectTenant).not.toHaveBeenCalled();
    });

    it('still comes up on an environment with no catalog at all', async () => {
      // A `prisma db push` dev database has no catalog rows. Features come
      // from overrides precisely so the demo works there.
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({
        featureOverrides: null,
      });
      (prisma.marketplaceAddOn.findMany as jest.Mock).mockResolvedValue([]);

      await expect(service.ensureDemoTenant()).resolves.toMatchObject({
        id: 'demo-admin',
      });
      expect(tenantMarketplace.purchase).not.toHaveBeenCalled();
      expect(prisma.tenant.update).toHaveBeenCalled();
    });
  });
});