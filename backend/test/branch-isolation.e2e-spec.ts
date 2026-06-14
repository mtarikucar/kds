/**
 * Cross-branch isolation E2E — Track 1 branch-scope hardening capstone.
 *
 * WHAT THIS PROVES
 * ----------------
 * The v3.0.0 strict BranchGuard + the per-service `branchScope()` Prisma
 * predicates must hold *over HTTP*, not just in unit tests. A MANAGER
 * pinned to branch B-1 must never see or mutate branch B-2's rows. This
 * suite drives the real Nest app (AppModule + global guards + global
 * `api` prefix) and asserts isolation across three independently-scoped
 * domains:
 *
 *   - cash-drawer  → GET  /api/cash-drawer/movements/pending
 *   - kds          → GET  /api/kds/orders  +  PATCH /api/kds/orders/:id/status
 *   - personnel    → GET  /api/personnel/schedule
 *
 * For each, B-2 data is seeded directly in the DB, then manager-A (pinned
 * to B-1 via X-Branch-Id) asks for it: it must be invisible on reads and
 * 404/403 on writes, with the underlying row left unchanged.
 *
 * WHY IT IS ENV-GATED (skipped by default)
 * ----------------------------------------
 * This suite SEEDS and (in afterAll) WIPES tenant-scoped rows. There is
 * no dedicated test database in the default dev environment and no
 * DATABASE_URL pointed at a throwaway DB — running destructive seed/clean
 * against the developer's live dev DB is unsafe. So, exactly like the
 * other `test/*.e2e-spec.ts` suites (which are `describe.skip`), this one
 * stays SKIPPED unless `RUN_DB_E2E` is explicitly set. Unlike them it is
 * written against the CURRENT Prisma schema and compiles cleanly under
 * `tsc --noEmit` (no `@ts-nocheck`).
 *
 * HOW TO RUN IT (locally / CI)
 * ----------------------------
 *   1. Stand up a THROWAWAY Postgres and migrate it:
 *        export DATABASE_URL="postgresql://user:pass@localhost:5432/kds_e2e"
 *        npx prisma migrate deploy        # or: npx prisma db push
 *   2. Run only this suite with the gate flipped on:
 *        RUN_DB_E2E=1 npm run test:e2e -- branch-isolation
 *
 * With RUN_DB_E2E unset, `npm run test:e2e` reports this whole block as
 * skipped and stays green.
 */
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

// Env-gate: only run when a dedicated test DB is explicitly provided.
// Default (`RUN_DB_E2E` unset) → describe.skip, keeping test:e2e green.
const dbE2E = process.env.RUN_DB_E2E ? describe : describe.skip;

dbE2E("Cross-branch isolation (Track 1)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  // Seeded ids, filled in beforeAll.
  let tenantId: string;
  let b1Id: string; // manager-A's branch
  let b2Id: string; // the "other" branch manager-A must never reach
  let managerAToken: string;

  // B-2 rows manager-A must never see/mutate.
  let b2MovementId: string;
  let b2OrderId: string;
  let b2AssignmentId: string;

  /**
   * Mint a valid access token using the SAME signing path the app uses
   * (auth.service.generateTokens → JwtService.sign with JWT_SECRET,
   * HS256). The payload mirrors the real claim shape so JwtStrategy.validate
   * accepts it: it looks the user up by `sub`, requires status ACTIVE +
   * tenant ACTIVE, and checks `ver === user.tokenVersion`. BranchGuard then
   * reads role + allowedBranchIds off req.user and the X-Branch-Id header.
   */
  function mintToken(user: {
    id: string;
    email: string;
    role: string;
    tenantId: string;
    primaryBranchId: string | null;
    allowedBranchIds: string[];
    tokenVersion: number;
  }): string {
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        type: "user" as const,
        ver: user.tokenVersion,
        primaryBranchId: user.primaryBranchId,
        activeBranchId: user.primaryBranchId,
        allowedBranchIds: user.allowedBranchIds,
      },
      {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN || "1h",
        algorithm: "HS256",
      },
    );
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirror main.ts: global `api` prefix + the same ValidationPipe config.
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    await app.init();

    // --- Subscription plan (personnel route is plan-gated) ---------------
    // ScheduleController requires @RequiresFeature(PERSONNEL_MANAGEMENT);
    // PlanFeatureGuard needs tenant.currentPlan with personnelManagement
    // = true AND a live (ACTIVE) Subscription row.
    const plan = await prisma.subscriptionPlan.create({
      data: {
        name: `BUSINESS-e2e-${Date.now()}`,
        displayName: "Business (e2e)",
        monthlyPrice: 0,
        yearlyPrice: 0,
        personnelManagement: true,
        kdsIntegration: true,
        posAccess: true,
      },
    });

    // --- Tenant + two branches -------------------------------------------
    const tenant = await prisma.tenant.create({
      data: {
        name: "Branch-Isolation E2E Tenant",
        subdomain: `branch-iso-e2e-${Date.now()}`,
        status: "ACTIVE",
        currentPlanId: plan.id,
      },
    });
    tenantId = tenant.id;

    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await prisma.subscription.create({
      data: {
        tenantId,
        planId: plan.id,
        status: "ACTIVE",
        billingCycle: "MONTHLY",
        paymentProvider: "EMAIL",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        amount: 0,
      },
    });

    const b1 = await prisma.branch.create({
      data: { tenantId, name: "Branch One", code: "B1", status: "active" },
    });
    const b2 = await prisma.branch.create({
      data: { tenantId, name: "Branch Two", code: "B2", status: "active" },
    });
    b1Id = b1.id;
    b2Id = b2.id;

    // --- One MANAGER per branch, pinned to that branch -------------------
    // primaryBranchId = home branch; UserBranchAssignment row gives the
    // allow-list BranchGuard enforces for MANAGER. Manager-A is allowed on
    // B-1 ONLY — that's the whole point of the isolation assertions.
    const managerA = await prisma.user.create({
      data: {
        email: `manager-a-${Date.now()}@iso.e2e`,
        password: "x", // login path is never exercised; tokens are minted directly
        firstName: "Manager",
        lastName: "A",
        role: "MANAGER",
        status: "ACTIVE",
        emailVerified: true,
        tenantId,
        primaryBranchId: b1Id,
        branchAssignments: { create: { branchId: b1Id, tenantId } },
      },
    });
    const managerB = await prisma.user.create({
      data: {
        email: `manager-b-${Date.now()}@iso.e2e`,
        password: "x",
        firstName: "Manager",
        lastName: "B",
        role: "MANAGER",
        status: "ACTIVE",
        emailVerified: true,
        tenantId,
        primaryBranchId: b2Id,
        branchAssignments: { create: { branchId: b2Id, tenantId } },
      },
    });

    managerAToken = mintToken({
      id: managerA.id,
      email: managerA.email,
      role: managerA.role,
      tenantId,
      primaryBranchId: b1Id,
      allowedBranchIds: [b1Id],
      tokenVersion: managerA.tokenVersion,
    });

    // --- Seed B-2 data manager-A must never reach ------------------------

    // cash-drawer: a DRAFT (CASH_OUT) movement on B-2.
    const b2Movement = await prisma.cashDrawerMovement.create({
      data: {
        tenantId,
        branchId: b2Id,
        userId: managerB.id,
        type: "CASH_OUT",
        amount: "42.00",
        approvalStatus: "DRAFT",
      },
    });
    b2MovementId = b2Movement.id;

    // kds: a kitchen-workflow order on B-2 (PENDING is in the KDS query set).
    const b2Order = await prisma.order.create({
      data: {
        orderNumber: `ISO-B2-${Date.now()}`,
        type: "DINE_IN",
        status: "PENDING",
        totalAmount: "10.00",
        finalAmount: "10.00",
        tenantId,
        branchId: b2Id,
        userId: managerB.id,
      },
    });
    b2OrderId = b2Order.id;

    // personnel: a shift assignment on B-2 (via a B-2 shift template).
    const b2Template = await prisma.shiftTemplate.create({
      data: {
        name: "B2 Morning",
        startTime: "09:00",
        endTime: "17:00",
        tenantId,
        branchId: b2Id,
      },
    });
    const assignmentDate = new Date();
    assignmentDate.setHours(0, 0, 0, 0);
    const b2Assignment = await prisma.shiftAssignment.create({
      data: {
        date: assignmentDate,
        userId: managerB.id,
        shiftTemplateId: b2Template.id,
        tenantId,
        branchId: b2Id,
      },
    });
    b2AssignmentId = b2Assignment.id;
  });

  afterAll(async () => {
    // Targeted cleanup — delete only what this suite seeded, in FK order.
    // The tenant cascade handles most rows; SubscriptionPlan is tenant-
    // independent so it's removed explicitly last.
    if (prisma && tenantId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { currentPlanId: true },
      });
      // Detach currentPlan FK before deleting the plan (onDelete: SetNull
      // would handle it, but tenant delete cascades first anyway).
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
      if (tenant?.currentPlanId) {
        await prisma.subscriptionPlan
          .delete({ where: { id: tenant.currentPlanId } })
          .catch(() => {});
      }
    }
    if (app) await app.close();
  });

  describe("cash-drawer", () => {
    it("manager-A (B-1) does not see B-2's pending DRAFT movement", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/cash-drawer/movements/pending")
        .set("Authorization", `Bearer ${managerAToken}`)
        .set("X-Branch-Id", b1Id)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map((m: { id: string }) => m.id);
      expect(ids).not.toContain(b2MovementId);
    });
  });

  describe("kds", () => {
    it("manager-A (B-1) does not see B-2's kitchen order in the feed", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/kds/orders")
        .set("Authorization", `Bearer ${managerAToken}`)
        .set("X-Branch-Id", b1Id)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = res.body.map((o: { id: string }) => o.id);
      expect(ids).not.toContain(b2OrderId);
    });

    it("manager-A (B-1) cannot mutate B-2's order status (404), row unchanged", async () => {
      await request(app.getHttpServer())
        .patch(`/api/kds/orders/${b2OrderId}/status`)
        .set("Authorization", `Bearer ${managerAToken}`)
        .set("X-Branch-Id", b1Id)
        .send({ status: "PREPARING" })
        // The KDS service scopes the lookup by (tenantId, branchId); a B-2
        // id read under a B-1 scope is NotFound, not Forbidden.
        .expect(404);

      const after = await prisma.order.findUnique({
        where: { id: b2OrderId },
        select: { status: true },
      });
      expect(after?.status).toBe("PENDING");
    });
  });

  describe("personnel", () => {
    it("manager-A (B-1) does not see B-2's shift assignment in the schedule", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/personnel/schedule")
        .set("Authorization", `Bearer ${managerAToken}`)
        .set("X-Branch-Id", b1Id)
        .expect(200);

      const assignments: Array<{ id: string }> = res.body.assignments ?? [];
      const ids = assignments.map((a) => a.id);
      expect(ids).not.toContain(b2AssignmentId);
    });
  });
});
