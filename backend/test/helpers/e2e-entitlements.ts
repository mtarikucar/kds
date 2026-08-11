import { INestApplication } from "@nestjs/common";
import { PrismaService } from "../../src/prisma/prisma.service";
import { PlanProjectorService } from "../../src/modules/entitlements/plan-projector.service";

/**
 * Grant entitlement the way the product does: a catalog row plus an ownership
 * row, then a projection.
 *
 * Fixtures used to flip a SubscriptionPlan column instead. Nothing reads those
 * columns since v3.3.0, so such a fixture grants precisely nothing while
 * looking like setup — the partner-display suite failed exactly this way, with
 * every request 403'ing against a plan that said the feature was on.
 */
const YEAR_MS = 365 * 24 * 3600 * 1000;

export const LICENCE_CODE = "license_annual";

export async function upsertProduct(
  prisma: PrismaService,
  input: {
    code: string;
    name?: string;
    kind: string;
    billing?: string;
    priceCents?: number;
    grants: Record<string, unknown>;
    requiresLicense?: boolean;
    creditKind?: string;
    creditUnits?: number;
  },
) {
  return prisma.marketplaceAddOn.upsert({
    where: { code: input.code },
    update: {},
    create: {
      code: input.code,
      name: input.name ?? input.code,
      kind: input.kind,
      billing: input.billing ?? "annual",
      priceCents: input.priceCents ?? 99_000,
      grants: input.grants as never,
      status: "published",
      requiresLicense: input.requiresLicense ?? true,
      creditKind: input.creditKind ?? null,
      creditUnits: input.creditUnits ?? null,
    },
  });
}

/**
 * Own a product outright.
 *
 * `periodEnd` defaults to a year out; pass a past date to model a lapse. The
 * caller decides the ownership `status` because grace ("past_due") and expiry
 * behave differently and both matter.
 */
export async function ownProduct(
  prisma: PrismaService,
  tenantId: string,
  addOnId: string,
  opts: { status?: string; periodEnd?: Date; quantity?: number } = {},
) {
  return prisma.tenantAddOn.create({
    data: {
      tenantId,
      addOnId,
      quantity: opts.quantity ?? 1,
      status: opts.status ?? "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: opts.periodEnd ?? new Date(Date.now() + YEAR_MS),
    },
  });
}

/** The licence itself — the prerequisite that unsuppresses everything else. */
export async function grantLicence(
  prisma: PrismaService,
  tenantId: string,
  opts: { status?: string; periodEnd?: Date } = {},
) {
  const licence = await upsertProduct(prisma, {
    code: LICENCE_CODE,
    name: "HummyTummy Lisansı",
    kind: "license",
    priceCents: 299_000,
    grants: { "feature.license": true },
    requiresLicense: false,
  });
  return ownProduct(prisma, tenantId, licence.id, opts);
}

export async function project(app: INestApplication, tenantId: string) {
  await app.get(PlanProjectorService).projectTenant(tenantId);
}
