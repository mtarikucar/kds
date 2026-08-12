import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PlanProjectorService } from "../entitlements/plan-projector.service";
import { TenantMarketplaceService } from "../marketplace/tenant-marketplace.service";
import { DEMO_PLAN_NAME } from "./demo.constants";
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
  // Kept as its own static (referencing the shared constant) so nothing
  // else in this file has to change — DemoGuardService imports
  // DEMO_PLAN_NAME directly so both sides can never drift apart.
  private static readonly PLAN_NAME = DEMO_PLAN_NAME;
  private static readonly BRANCH_CODE = "MAIN";

  /**
   * Everything the demo tenant is given, as `override:admin` GRANTS.
   *
   * v3.3.0 changed what this map means. It used to be the pre-3.3
   * `featureOverrides` shape, where the projector wrapped every entry —
   * including `false` — in `{__replace: v}`. Under à-la-carte the tri-state
   * form is explicit: `mode:'grant'` projects a PLAIN `true`, which OR-folds
   * with everything else and can never suppress a product. The demo tenant
   * never buys anything, so a grant-mode override is exactly right for it:
   * every screen is reachable, and no poison-pill `__replace:false` is
   * written anywhere.
   *
   * The free core (POS, KDS, menu, tables, orders…) is NOT listed — it comes
   * from FREE_BASELINE_GRANTS like it does for every other tenant, which is
   * the point of the demo being representative.
   */
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
    // Drift fix: aiContentGeneration was missing from this mirror, and the
    // DEMO plan's AI limits were left at the schema default (0) — a demo
    // visitor could never open the AI menu studio, contradicting "every
    // screen reachable in the demo". Fixed alongside the AI limits below
    // (see plan-mapper-parity.spec.ts for the drift-class tripwire).
    aiContentGeneration: true,
    // Without this the demo would be dark: the projector suppresses every
    // requiresLicense product for an unlicensed tenant, and the demo owns no
    // products to be suppressed — but the guard still reads feature.license
    // when deciding whether a denial is "you need a licence".
    license: true,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly projector: PlanProjectorService,
    private readonly tenantMarketplace: TenantMarketplaceService,
  ) {}

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
    if (existing) {
      // RECONCILE, don't just return.
      //
      // This used to return the moment the demo user existed, so everything
      // the tenant is granted was written exactly once, at first seed. The
      // v3.3.0 `free_core` migration then archived and cleared
      // `Tenant.featureOverrides` for EVERY tenant — the demo included — and
      // nothing ever wrote them back. The demo silently dropped to the free
      // core: no reports, no reservations, no personnel, no stock, no AI, no
      // API. It stayed that way until a human noticed the settings nav had
      // gone short.
      //
      // A demo whose entitlements are written once is a demo that any future
      // data migration can quietly strip. Repairing on every entry costs a
      // couple of queries on a cold path and makes that class of failure
      // self-healing.
      await this.reconcileEntitlements(existing.tenantId);
      return existing;
    }

    return this.seed();
  }

  /**
   * Bring the demo tenant's grants back to what the demo promises: every
   * screen reachable.
   *
   * Two mechanisms, because one cannot express the other:
   *
   *   - FEATURES come from grant-mode `featureOverrides`. They work even in an
   *     environment whose catalog was never seeded (a `db push` dev database),
   *     which is why the demo does not rely on owning products for these.
   *   - INTEGRATIONS cannot be expressed as overrides at all — the projector
   *     writes `feature.${key}` for every override entry, so an
   *     `integration.sms` grant has no route through that map. They come from
   *     comped ownership rows instead, which is also the honest path: the demo
   *     exercises catalog → ownership → projector → guard exactly as a paying
   *     tenant does, instead of a special lane where an entire gate class can
   *     go untested. SMS settings, e-Belge/ÖKC and caller-ID were unreachable
   *     in the demo for this reason even before the migration.
   */
  private async reconcileEntitlements(tenantId: string): Promise<void> {
    const desired = DemoService.featureOverridePayload();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { featureOverrides: true },
    });

    const current = (tenant?.featureOverrides ?? null) as Record<
      string,
      unknown
    > | null;
    const featuresStale =
      !current || Object.keys(desired).some((k) => !(k in current));

    if (featuresStale) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { featureOverrides: desired as any },
      });
      this.logger.warn(
        `Demo tenant ${tenantId}: feature overrides were missing or stale — restored`,
      );
    }

    const comped = await this.compIntegrationProducts(tenantId);

    if (featuresStale || comped > 0) {
      await this.projector.projectTenant(tenantId);
    }
  }

  /**
   * Own the licence + every published integration product, for free.
   *
   * The licence first, and not only for symmetry: the projector suppresses
   * every `requiresLicense` product's grants while no LICENCE PRODUCT is
   * owned — a `feature.license` override does not satisfy it, because the
   * check reads ownership rows. Comping the integrations without the licence
   * would write rows that grant nothing.
   *
   * Products absent from the catalog are skipped rather than created: an
   * environment seeded with `prisma db push` has no catalog at all, and the
   * demo must still come up there.
   *
   * Returns how many rows it had to create.
   */
  private async compIntegrationProducts(tenantId: string): Promise<number> {
    const wanted = await this.prisma.marketplaceAddOn.findMany({
      where: {
        status: "published",
        OR: [{ kind: "license" }, { kind: "integration" }],
      },
      // The licence first: purchase() stamps the anniversary anchor off it,
      // and the projector suppresses every requiresLicense product until a
      // licence PRODUCT is owned.
      orderBy: { kind: "asc" },
      select: { id: true, code: true, kind: true },
    });
    if (wanted.length === 0) return 0;

    const held = await this.prisma.tenantAddOn.findMany({
      where: {
        tenantId,
        status: "active",
        addOnId: { in: wanted.map((w) => w.id) },
      },
      select: { addOnId: true },
    });
    const heldIds = new Set(held.map((h) => h.addOnId));
    const missing = wanted.filter((w) => !heldIds.has(w.id));
    if (missing.length === 0) return 0;

    // Through purchase(), NOT a raw row insert.
    //
    // The first cut wrote TenantAddOn rows directly and skipped everything
    // purchase() does around them — including stamping `licenseAnchorAt`. The
    // demo ended up holding a live licence with no anchor, the licensing
    // snapshot read the anchor to decide licence state and reported "none",
    // and the storefront duly added a SECOND licence to every basket, which
    // checkout refused as already-owned — taking the module the visitor
    // actually wanted down with it.
    let created = 0;
    for (const product of missing) {
      try {
        await this.tenantMarketplace.purchase(
          tenantId,
          { addOnCode: product.code, quantity: 1 },
          undefined,
          {
            comp: {
              actorId: "system:demo-seed",
              reason: "Demo restaurant — every screen reachable",
            },
          },
        );
        created += 1;
      } catch (err) {
        // One unsellable product must not stop the demo coming up. A draft or
        // archived catalog row, or a dependency this environment lacks, is a
        // catalog problem — not a reason to serve a broken demo.
        this.logger.warn(
          `Demo tenant ${tenantId}: could not comp ${product.code} — ${
            (err as Error).message
          }`,
        );
      }
    }
    if (created > 0) {
      this.logger.warn(
        `Demo tenant ${tenantId}: comped ${created} product(s) through the purchase path`,
      );
    }
    return created;
  }

  /** The override map, in the projector's grant-mode shape. */
  private static featureOverridePayload(): Record<string, { mode: string }> {
    return Object.fromEntries(
      Object.entries(DemoService.ALL_FEATURES)
        .filter(([, on]) => on)
        .map(([key]) => [key, { mode: "grant" }]),
    );
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
        // Drift fix: maxBranches was missing from this create block, so it
        // silently fell through to the Prisma schema default (1) — even
        // though ALL_FEATURES.multiLocation is true and BranchesController
        // gates branch creation on BOTH the MULTI_LOCATION feature AND the
        // maxBranches limit. A demo visitor with the
        // "add another branch" feature visibly on would hit the cap on the
        // very first attempt (the seeded Main branch already consumes the
        // only slot). Matches BUSINESS-tier's unlimited value (prisma/seed.ts)
        // — same "generous top-tier-equivalent" pattern as every other limit
        // here (see plan-mapper-parity.spec.ts for the drift-class tripwire).
        maxBranches: -1,
        maxProducts: 9999,
        maxCategories: 999,
        maxMonthlyOrders: 999999,
        // Discoverable AI menu-studio quota (BUSINESS-tier values) so the
        // demo tenant can actually open the AI menu studio — pre-fix these
        // were left at the schema default (0), silently disabling the
        // feature ALL_FEATURES.aiContentGeneration claims to grant.
        maxMonthlyAiPhotos: 200,
        maxMonthlyAiVideos: 20,
        maxMonthlyAi3dModels: 30,
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
        // Grant-mode overrides: plain `true` grants, never `__replace:false`.
        featureOverrides: DemoService.featureOverridePayload() as any,
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
    // Integrations + the licence they hang off, and the projection that makes
    // any of it visible.
    await this.reconcileEntitlements(tenant.id);

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
