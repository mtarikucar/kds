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
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(prisma.subscriptionPlan.upsert).not.toHaveBeenCalled();
  });

  it('seeds the full demo on a cold start (plan, tenant, branch, sub, admin, content)', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.subscriptionPlan.upsert as jest.Mock).mockResolvedValue({ id: 'plan-demo' });
    (prisma.tenant.create as jest.Mock).mockResolvedValue({
      id: 'tenant-demo',
      subdomain: 'demo',
    });
    (prisma.branch.create as jest.Mock).mockResolvedValue({ id: 'branch-demo' });
    (prisma.subscription.create as jest.Mock).mockResolvedValue({ id: 'sub-demo' });
    (prisma.user.create as jest.Mock).mockResolvedValue({
      id: 'admin-demo',
      email: DemoService.ADMIN_EMAIL,
      firstName: 'Demo',
      lastName: 'Yönetici',
      role: 'ADMIN',
      tenantId: 'tenant-demo',
      phone: '+905550000000',
      locale: null,
    });
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
    expect(prisma.tenant.create).toHaveBeenCalledTimes(1);
    expect(prisma.branch.create).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.create).toHaveBeenCalledTimes(1);
    // Showcase content seeded.
    expect((prisma.category.create as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect((prisma.product.create as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect((prisma.table.create as jest.Mock).mock.calls.length).toBe(8);
    expect((prisma.order.create as jest.Mock).mock.calls.length).toBe(6);
  });

  it('resetDemoData is a no-op before the demo tenant exists', async () => {
    (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(null);
    await service.resetDemoData();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.order.deleteMany).not.toHaveBeenCalled();
  });
});
