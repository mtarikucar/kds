import { PrismaService } from "../../../prisma/prisma.service";
import { EntitlementService } from "../../entitlements/entitlement.service";
import { PlanFeature } from "../../../common/constants/subscription.enum";

/**
 * Shared "is the reservation system entitled for this tenant?" check for the
 * PUBLIC (@Public(), un-guarded) reservation surface.
 *
 * The authenticated ReservationsController is gated by PlanFeatureGuard +
 * @RequiresFeature(RESERVATION_SYSTEM). The public booking endpoints are all
 * @Public(), so PlanFeatureGuard short-circuits to `true` for them and nothing
 * enforces the plan — a tenant whose plan excludes reservations would still
 * accept guest bookings the operator can never see/act on (book-into-a-void).
 *
 * This helper reproduces the SAME resolution PlanFeatureGuard uses
 * (entitlement engine first — honoring plan + add-on grants + admin overrides —
 * with the plan-only fallback for the projector race / fresh signup), so the
 * public surface matches the admin gate exactly. It deliberately does NOT rely
 * on ReservationSettings.isEnabled (schema default `true`, never coupled to the
 * plan feature).
 */
const FEATURE_KEY = `feature.${PlanFeature.RESERVATION_SYSTEM}`; // "feature.reservationSystem"

export async function isReservationFeatureEnabled(
  prisma: PrismaService,
  entitlements: EntitlementService,
  tenantId: string,
): Promise<boolean> {
  const set = await entitlements.getForTenant(tenantId, null);

  // Engine populated — trust it (its fold already applied plan + add-on +
  // admin overrides), mirroring PlanFeatureGuard.canActivate.
  if (Object.keys(set.features).length > 0) {
    return set.features[FEATURE_KEY] === true;
  }

  // Engine empty for this tenant (projector race / new signup). Fall back to
  // the plan-only view exactly like the guard's fallback branch:
  // featureOverride (if set) else the current plan's column.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { currentPlan: true },
  });
  if (!tenant || !tenant.currentPlan) {
    return false;
  }
  const overrides = tenant.featureOverrides as Record<string, boolean> | null;
  const key = PlanFeature.RESERVATION_SYSTEM; // "reservationSystem"
  if (overrides && overrides[key] !== undefined) {
    return overrides[key] === true;
  }
  return (tenant.currentPlan as Record<string, unknown>)[key] === true;
}
