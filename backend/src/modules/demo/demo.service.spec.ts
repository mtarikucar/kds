import { Test, TestingModule } from '@nestjs/testing';
import { DemoService } from './demo.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';

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

  beforeEach(async () => {
    prisma = mockPrismaClient();
    const module: TestingModule = await Test.createTestingModule({
      providers: [DemoService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(DemoService);
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'debug').mockImplementation(() => undefined);
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
    // Idempotent: tenant/branch/admin go through upsert on their unique keys so
    // a pre-existing/partial demo never collides on the subdomain.
    const tenantArgs = (prisma.tenant.upsert as jest.Mock).mock.calls[0][0];
    expect(tenantArgs.where.subdomain).toBe('demo-explore');
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
});
