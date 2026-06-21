import { randomUUID } from "node:crypto";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/prisma/prisma.service";
import { HttpExceptionFilter } from "../../src/common/filters/http-exception.filter";

const cookieParser = require("cookie-parser");

/**
 * Real-database e2e harness.
 *
 * Boots the actual Nest DI container against a real (throwaway) Postgres so
 * write paths run against the real schema — the only way to catch the class of
 * bug where a Prisma create feeds null/undefined into a NOT NULL relation FK
 * (mocked-Prisma unit tests silently accept it; the real engine throws
 * "Argument `<relation>` is missing" / a NOT NULL violation).
 *
 * Requires DATABASE_URL pointing at a DB whose schema is in sync
 * (`prisma db push`) and a reachable Redis (REDIS_URL or the default
 * redis://localhost:6379) — AppService + the entitlement bus open Redis clients
 * at boot, and an unreachable one leaves a dangling handle so jest never exits.
 */
export async function bootE2EApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  const mod = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = mod.createNestApplication();
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma };
}

/**
 * Wipe every row between tests. TRUNCATE ... CASCADE on every public table
 * (except Prisma's migration bookkeeping) — order-independent and fast.
 */
export async function resetDb(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}

/**
 * Seed a tenant + its Main branch + an ADMIN user (primaryBranchId wired to the
 * branch). Enough to exercise branch-scoped write paths. The user email is
 * globally unique so seeds never collide even across spec files sharing the DB.
 */
export async function seedTenantBranchUser(
  prisma: PrismaService,
  opts: { userPhone?: string | null } = {},
): Promise<{ tenantId: string; branchId: string; userId: string }> {
  const uniq = randomUUID();
  const tenant = await prisma.tenant.create({
    data: { name: `E2E Tenant ${uniq}`, status: "ACTIVE" },
  });
  const branch = await prisma.branch.create({
    data: { tenantId: tenant.id, name: "Main" },
  });
  const user = await prisma.user.create({
    data: {
      email: `e2e-${uniq}@example.com`,
      password: "x".repeat(20),
      firstName: "E2E",
      lastName: "User",
      role: "ADMIN",
      tenantId: tenant.id,
      primaryBranchId: branch.id,
      phone: opts.userPhone ?? null,
    },
  });
  return { tenantId: tenant.id, branchId: branch.id, userId: user.id };
}

/**
 * Boot the app the way main.ts does for HTTP-level e2e: global `api` prefix,
 * cookie-parser, the same ValidationPipe, and the HttpExceptionFilter. Use this
 * (over bootE2EApp) when a spec drives real HTTP requests through the full guard
 * chain (Jwt → Roles → Tenant → Branch → SubscriptionStatus).
 */
export async function bootHttpApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  const mod = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = mod.createNestApplication();
  app.setGlobalPrefix("api");
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma };
}

const DEFAULT_PW = "Passw0rd1";

/**
 * Seed a tenant that is LIVE (a TRIALING subscription) so its branch-scoped
 * routes pass SubscriptionStatusGuard. Returns login-ready credentials. The
 * password is bcrypt-hashed so the real /auth/login flow works.
 */
export async function seedLiveTenant(
  prisma: PrismaService,
  opts: { role?: string; password?: string } = {},
): Promise<{
  tenantId: string;
  branchId: string;
  userId: string;
  email: string;
  password: string;
}> {
  const uniq = randomUUID();
  const password = opts.password ?? DEFAULT_PW;
  const plan = await prisma.subscriptionPlan.create({
    data: {
      name: `E2E_PLAN_${uniq}`,
      displayName: "E2E Plan",
      monthlyPrice: "0.00",
      yearlyPrice: "0.00",
    },
  });
  const tenant = await prisma.tenant.create({
    data: { name: `E2E Tenant ${uniq}`, status: "ACTIVE" },
  });
  const branch = await prisma.branch.create({
    data: { tenantId: tenant.id, name: "Main" },
  });
  const user = await prisma.user.create({
    data: {
      email: `e2e-${uniq}@example.com`,
      password: bcrypt.hashSync(password, 10),
      firstName: "E2E",
      lastName: "User",
      role: opts.role ?? "ADMIN",
      tenantId: tenant.id,
      primaryBranchId: branch.id,
      emailVerified: true,
    },
  });
  const now = new Date();
  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      planId: plan.id,
      status: "TRIALING",
      billingCycle: "MONTHLY",
      paymentProvider: "EMAIL",
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      amount: "0.00",
    },
  });
  return {
    tenantId: tenant.id,
    branchId: branch.id,
    userId: user.id,
    email: user.email,
    password,
  };
}

/** Log in via the real HTTP endpoint and return the bearer access token. */
export async function loginAs(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post("/api/auth/login")
    .send({ email, password });
  if (!res.body?.accessToken) {
    throw new Error(
      `login failed (${res.status}): ${JSON.stringify(res.body)}`,
    );
  }
  return res.body.accessToken;
}
