import { EntitlementService } from "../../entitlements/entitlement.service";
import { PlanFeature } from "../../../common/constants/subscription.enum";

/**
 * Shared "is the reservation system entitled for this tenant?" check for the
 * PUBLIC (@Public(), un-guarded) reservation surface.
 *
 * The authenticated ReservationsController is gated by
 * `@RequiresFeature(RESERVATION_SYSTEM)`. The public booking endpoints are all
 * `@Public()`, so the guard short-circuits to `true` for them and nothing
 * enforces entitlement — a tenant without the reservation module would still
 * accept guest bookings the operator can never see or act on
 * (book-into-a-void). This helper closes that gap.
 *
 * v3.3.0 reduced it to a single engine read. The pre-3.3 version mirrored
 * PlanFeatureGuard's fallback chain (engine → featureOverrides → plan column)
 * because the engine could legitimately be empty during the projector's
 * warm-up. That window is gone: the free baseline is projected for every
 * tenant unconditionally, so an empty set means "no access", not "not ready".
 * It deliberately does NOT consult `ReservationSettings.isEnabled`, whose
 * schema default is `true` and was never coupled to entitlement.
 */
const FEATURE_KEY = `feature.${PlanFeature.RESERVATION_SYSTEM}`;

export async function isReservationFeatureEnabled(
  entitlements: EntitlementService,
  tenantId: string,
): Promise<boolean> {
  const set = await entitlements.getForTenant(tenantId, null);
  return set.features[FEATURE_KEY] === true;
}
