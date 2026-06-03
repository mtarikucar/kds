/**
 * v3.0.0 — one-shot post-migration reprojection.
 *
 * Migration `20260602100000_v3_plan_pos_and_branch_limits` adds two
 * columns to `SubscriptionPlan`:
 *   - `posAccess`   (Boolean, default true; FREE flipped to false)
 *   - `maxBranches` (Int, default 1; per-tier seeded)
 *
 * The entitlement engine projects these columns into the per-tenant
 * `FeatureEntitlement` rows that PlanFeatureGuard reads. Projection
 * runs on every subscription/addon mutation and once per night via
 * the reconcile cron — meaning a freshly-migrated tenant's cached
 * engine set lacks `feature.posAccess` and `limit.maxBranches` until
 * one of those triggers fires.
 *
 * This script forces an immediate reprojection of every tenant, then
 * flushes the in-process + Redis-fanned cache via the existing
 * `EntitlementInvalidationBus` (the projector calls invalidate()
 * unconditionally after a successful project). Run it ONCE as a
 * `prisma migrate deploy` post-hook so the deploy window has no
 * "engine knows the column, but cache doesn't" drift.
 *
 * Run with:  `npx ts-node scripts/reproject-all-tenants.ts`
 *
 * Idempotent. Re-runs are cheap (one read + one upsert per tenant).
 *
 * Exit 0 on success, 1 on any tenant failure (others still attempt).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PlanProjectorService } from '../src/modules/entitlements/plan-projector.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  // Use createApplicationContext (not create) — no HTTP server, no
  // global guards, no Express overhead. We only need the DI graph for
  // the projector + Prisma.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const projector = app.get(PlanProjectorService);
    const prisma = app.get(PrismaService);

    const tenants = await prisma.tenant.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log(
      `[reproject] starting reprojection for ${tenants.length} tenant(s)`,
    );

    let succeeded = 0;
    let failed = 0;
    for (const t of tenants) {
      try {
        await projector.projectTenant(t.id);
        succeeded++;
        if (succeeded % 50 === 0) {
          console.log(`[reproject] progress: ${succeeded}/${tenants.length}`);
        }
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[reproject] FAILED for tenant=${t.id} (${t.name}): ${msg}`,
        );
      }
    }

    console.log(
      `[reproject] done: succeeded=${succeeded} failed=${failed} total=${tenants.length}`,
    );

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[reproject] fatal error:', err);
  process.exit(1);
});
