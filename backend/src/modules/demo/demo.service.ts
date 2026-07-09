import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { withAdvisoryLock } from "../../common/scheduling/advisory-lock";
import { UserRole } from "../../common/constants/roles.enum";
import {
  OrderStatus,
  OrderType,
  TableStatus,
} from "../../common/constants/order-status.enum";

/**
 * Self-contained, idempotent demo environment. A single shared "demo restaurant"
 * tenant, richly enough seeded that a new user can switch in and SEE the system
 * working (menu, POS, tables, kitchen tickets, dashboard) and the guided tours
 * have real data to point at. The /auth/demo-session endpoint mints a
 * demo-scoped access token for the demo admin user so the switch needs no
 * separate login and never touches the real user's session.
 *
 * Interactive: changes a visitor makes (placing orders, moving tickets) land on
 * the demo tenant; a daily reset re-seeds the transactional data so it stays
 * presentable. The seed is idempotent and runs lazily on the first demo-session
 * request, so the demo exists everywhere (incl. prod) with no manual seed step.
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  // Reserved subdomain for the explore-demo tenant. Deliberately NOT "demo" —
  // prisma/seed.ts already owns "demo" ("Demo Restaurant"), so creating another
  // would hit the subdomain unique constraint ("A record with this subdomain
  // already exists"). This one is ours alone.
  static readonly SUBDOMAIN = "demo-explore";
  static readonly ADMIN_EMAIL = "demo-admin@demo.hummytummy.local";
  private static readonly PLAN_NAME = "DEMO";
  private static readonly BRANCH_CODE = "MAIN";

  // All plan features ON so every screen is reachable in the demo. Mirrors the
  // tenant featureOverrides contract (PlanFeatureGuard fallback reads these).
  private static readonly ALL_FEATURES = {
    advancedReports: true,
    multiLocation: true,
    customBranding: true,
    apiAccess: true,
    externalDisplay: true,
    prioritySupport: true,
    inventoryTracking: true,
    kdsIntegration: true,
    reservationSystem: true,
    personnelManagement: true,
    deliveryIntegration: true,
    posAccess: true,
  };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the demo admin user (with the fields generateTokens needs),
   * creating the entire demo tenant on first call. Idempotent + concurrency-safe
   * (the tenant lookup short-circuits once seeded).
   */
  async ensureDemoTenant() {
    const existing = await this.prisma.user.findFirst({
      where: { email: DemoService.ADMIN_EMAIL },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        phone: true,
        locale: true,
      },
    });
    if (existing) return existing;

    return this.seed();
  }

  private async seed() {
    const plan = await this.prisma.subscriptionPlan.upsert({
      where: { name: DemoService.PLAN_NAME },
      update: {},
      create: {
        name: DemoService.PLAN_NAME,
        displayName: "Demo",
        // Not offered to real tenants — internal demo plan only.
        isActive: false,
        isPublic: false,
        monthlyPrice: "0.00",
        yearlyPrice: "0.00",
        trialDays: 0,
        maxUsers: 999,
        maxTables: 999,
        maxProducts: 9999,
        maxCategories: 999,
        maxMonthlyOrders: 999999,
        ...DemoService.ALL_FEATURES,
      },
    });

    // Every step is find-or-create so the seed is idempotent AND self-healing:
    // a re-run, a partial prior seed (tenant created but a later step threw), or
    // two simultaneous first-clicks all converge instead of colliding. Upserts
    // key on the unique columns (subdomain, (tenantId,code), email).
    const tenant = await this.prisma.tenant.upsert({
      where: { subdomain: DemoService.SUBDOMAIN },
      update: {},
      create: {
        name: "HummyTummy Demo Restoran",
        subdomain: DemoService.SUBDOMAIN,
        status: "ACTIVE",
        currentPlanId: plan.id,
        featureOverrides: DemoService.ALL_FEATURES as any,
      },
    });

    const branch = await this.prisma.branch.upsert({
      where: {
        tenantId_code: {
          tenantId: tenant.id,
          code: DemoService.BRANCH_CODE,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        name: "Merkez",
        code: DemoService.BRANCH_CODE,
        status: "active",
      },
    });

    const existingSub = await this.prisma.subscription.findFirst({
      where: { tenantId: tenant.id },
      select: { id: true },
    });
    if (!existingSub) {
      const now = new Date();
      await this.prisma.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: "ACTIVE",
          billingCycle: "MONTHLY",
          paymentProvider: "EMAIL",
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 365 * 24 * 3600 * 1000),
          amount: "0.00",
        },
      });
    }

    const admin = await this.prisma.user.upsert({
      where: { email: DemoService.ADMIN_EMAIL },
      update: {},
      create: {
        email: DemoService.ADMIN_EMAIL,
        // Login is never used for the demo (the session is minted directly);
        // a random hash keeps the credential unusable.
        password: bcrypt.hashSync(`demo-${tenant.id}`, 10),
        firstName: "Demo",
        lastName: "Yönetici",
        role: UserRole.ADMIN,
        tenantId: tenant.id,
        primaryBranchId: branch.id,
        emailVerified: true,
        status: "ACTIVE",
        phone: "+905550000000",
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
        phone: true,
        locale: true,
      },
    });

    // Showcase content once — only when the menu is still empty so re-runs
    // don't pile up duplicate categories/products/tables.
    const categoryCount = await this.prisma.category.count({
      where: { tenantId: tenant.id },
    });
    if (categoryCount === 0) {
      await this.seedContent(tenant.id, branch.id, admin.id);
    }
    this.logger.log(`Ensured demo tenant ${tenant.id} (${tenant.subdomain})`);
    return admin;
  }

  /** Menu + tables + sample orders — the showcase content. */
  private async seedContent(
    tenantId: string,
    branchId: string,
    userId: string,
  ) {
    const catalog: { cat: string; items: [string, number][] }[] = [
      {
        cat: "Başlangıçlar",
        items: [
          ["Mercimek Çorbası", 65],
          ["Humus", 85],
          ["Sigara Böreği", 75],
        ],
      },
      {
        cat: "Ana Yemekler",
        items: [
          ["Adana Kebap", 245],
          ["Izgara Köfte", 210],
          ["Tavuk Şiş", 195],
          ["Karışık Izgara", 320],
        ],
      },
      {
        cat: "Pideler",
        items: [
          ["Kıymalı Pide", 165],
          ["Kaşarlı Pide", 155],
        ],
      },
      {
        cat: "Tatlılar",
        items: [
          ["Künefe", 120],
          ["Baklava", 110],
        ],
      },
      {
        cat: "İçecekler",
        items: [
          ["Ayran", 35],
          ["Şalgam", 40],
          ["Türk Kahvesi", 55],
        ],
      },
    ];

    const products: { id: string; price: number; name: string }[] = [];
    let displayOrder = 0;
    for (const { cat, items } of catalog) {
      const category = await this.prisma.category.create({
        data: {
          name: cat,
          tenantId,
          displayOrder: displayOrder++,
          isActive: true,
        },
      });
      for (const [name, price] of items) {
        const p = await this.prisma.product.create({
          data: {
            name,
            price: new Prisma.Decimal(price),
            categoryId: category.id,
            tenantId,
            isAvailable: true,
            stockTracked: false,
          },
          select: { id: true, price: true, name: true },
        });
        products.push({ id: p.id, price: Number(p.price), name: p.name });
      }
    }

    // 8 tables, a couple already occupied for a lively floor view.
    const tables: { id: string; number: string }[] = [];
    for (let i = 1; i <= 8; i++) {
      const t = await this.prisma.table.create({
        data: {
          number: String(i),
          capacity: i % 3 === 0 ? 6 : 4,
          tenantId,
          branchId,
          status: i <= 2 ? TableStatus.OCCUPIED : TableStatus.AVAILABLE,
        },
        select: { id: true, number: true },
      });
      tables.push({ id: t.id, number: t.number });
    }

    await this.seedOrders(tenantId, branchId, userId, products, tables);
  }

  /** A spread of orders across statuses so KDS / dashboard look real. */
  private async seedOrders(
    tenantId: string,
    branchId: string,
    userId: string,
    products: { id: string; price: number; name: string }[],
    tables: { id: string; number: string }[],
  ) {
    const statuses = [
      OrderStatus.PENDING,
      OrderStatus.PREPARING,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.SERVED,
      OrderStatus.PAID,
    ];
    let seq = 1;
    for (const status of statuses) {
      const picks = [
        products[seq % products.length],
        products[(seq + 3) % products.length],
      ];
      const items = picks.map((p) => ({
        productId: p.id,
        quantity: 1 + (seq % 2),
        unitPrice: new Prisma.Decimal(p.price),
        subtotal: new Prisma.Decimal(p.price * (1 + (seq % 2))),
      }));
      const total = items.reduce((a, it) => a + Number(it.subtotal), 0);
      await this.prisma.order.create({
        data: {
          orderNumber: `DEMO-${String(seq).padStart(4, "0")}`,
          type: OrderType.DINE_IN,
          status,
          tenantId,
          branchId,
          userId,
          tableId: tables[seq % tables.length].id,
          totalAmount: new Prisma.Decimal(total),
          finalAmount: new Prisma.Decimal(total),
          orderItems: { create: items },
        },
      });
      seq++;
    }
  }

  /**
   * Daily reset: wipe the demo tenant's transactional data and re-seed the
   * sample orders so accumulated visitor activity doesn't pile up. Menu + tables
   * are kept stable. No-op until the demo tenant has been created.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async resetDemoData(): Promise<void> {
    // Multi-replica guard: only one replica runs the destructive wipe + reseed
    // per tick. Without it every replica deletes and re-seeds the demo tenant,
    // double-seeding the sample orders.
    await withAdvisoryLock(
      this.prisma,
      "demo.resetDemoData",
      () => this.resetDemoDataInner(),
      this.logger,
    );
  }

  private async resetDemoDataInner(): Promise<void> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { subdomain: DemoService.SUBDOMAIN },
      select: { id: true },
    });
    if (!tenant) return;
    const admin = await this.prisma.user.findFirst({
      where: { email: DemoService.ADMIN_EMAIL },
      select: { id: true },
    });
    const branch = await this.prisma.branch.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!admin || !branch) return;

    await this.prisma.$transaction([
      this.prisma.orderItemModifier.deleteMany({
        where: { orderItem: { order: { tenantId: tenant.id } } },
      }),
      this.prisma.orderItem.deleteMany({
        where: { order: { tenantId: tenant.id } },
      }),
      this.prisma.payment.deleteMany({ where: { tenantId: tenant.id } }),
      this.prisma.order.deleteMany({ where: { tenantId: tenant.id } }),
    ]);

    const products = await this.prisma.product.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, price: true, name: true },
    });
    const tables = await this.prisma.table.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, number: true },
    });
    if (products.length === 0 || tables.length === 0) return;
    await this.seedOrders(
      tenant.id,
      branch.id,
      admin.id,
      products.map((p) => ({ id: p.id, price: Number(p.price), name: p.name })),
      tables,
    );
    this.logger.log(`Reset demo tenant ${tenant.id} transactional data`);
  }
}
