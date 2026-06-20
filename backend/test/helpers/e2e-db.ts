import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/prisma/prisma.service";

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
 * (`prisma db push`). REDIS_URL must be UNSET — the app boots Redis-less.
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
