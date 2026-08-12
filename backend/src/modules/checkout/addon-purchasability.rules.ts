import { EntitlementSet } from "../entitlements/entitlement.types";
import { featureKey } from "../entitlements/entitlement-keys.const";
import { TenantMarketplaceService } from "../marketplace/tenant-marketplace.service";
import { LICENSE_ADDON_CODE } from "../marketplace/catalog-validation";

export type AddonPurchasabilityErrorCode =
  | "ADDON_ALREADY_GRANTED"
  | "ADDON_ALREADY_OWNED"
  | "ADDON_REQUIRES_DEPENDENCY"
  | "ADDON_LIMIT_REDUNDANT"
  | "ADDON_MAX_QUANTITY"
  | "LICENSE_REQUIRED";

export interface PurchaseBlock {
  code: AddonPurchasabilityErrorCode;
  addOnCode: string;
  message: string;
}

export interface PurchasabilityFacts {
  addOn: {
    code: string;
    name: string;
    kind: string;
    grants: Record<string, unknown> | null;
    requiresLicense: boolean;
    maxQuantity: number | null;
  };
  /** The tenant's EFFECTIVE entitlements, from any source. */
  entitlements: EntitlementSet;
  /** Units of this exact product already held on an active row. */
  ownedQuantity: number;
  /** Whether an active row exists for this product at this scope. */
  isOwned: boolean;
  /** Units being asked for. */
  quantity: number;
  /** Codes present in the same cart (a sibling line can satisfy the licence). */
  cartCodes?: ReadonlySet<string>;
  /** A renewal re-buys what is already held — that is what a renewal IS. */
  isRenewal?: boolean;
}

/**
 * Can this tenant buy this product right now — and if not, why?
 *
 * Extracted so exactly one implementation answers the question for both the
 * pre-payment guard and the storefront. They used to answer it separately:
 * the guard from the tenant's effective entitlements, the store from whether
 * an ownership ROW existed. Anything granted without a row — a comp, an
 * operator override, the demo tenant's whole feature set — therefore showed a
 * Buy button that checkout refuses with ADDON_ALREADY_GRANTED. The customer
 * ticks a line, pays nothing, and gets an error naming a product they did not
 * pick, because a rejected line fails the entire cart.
 *
 * Pure: no IO, no Prisma. Callers gather the facts however suits them — the
 * guard reads per product, the licensing snapshot already has all of it loaded.
 * Order mirrors the guard's original sequence exactly.
 */
export function evaluatePurchasability(
  facts: PurchasabilityFacts,
): PurchaseBlock | null {
  const {
    addOn,
    entitlements: ent,
    ownedQuantity,
    isOwned,
    quantity,
    cartCodes = new Set<string>(),
    isRenewal = false,
  } = facts;

  const block = (
    code: AddonPurchasabilityErrorCode,
    message: string,
  ): PurchaseBlock => ({ code, addOnCode: addOn.code, message });

  const hasLicense = ent.features?.[featureKey("license")] === true;

  // 1) The licence prerequisite. Everything gated on it is unusable without
  // one — the projector suppresses the grants of every `requiresLicense`
  // product while the licence is dark — so selling one first would take money
  // for access the buyer cannot exercise.
  if (
    addOn.requiresLicense &&
    !hasLicense &&
    !cartCodes.has(LICENSE_ADDON_CODE)
  ) {
    return block(
      "LICENSE_REQUIRED",
      `"${addOn.name}" requires an active HummyTummy licence. Add the licence to your cart first.`,
    );
  }

  // 2) The licence itself: one at a time — EXCEPT on a renewal, which re-pays
  // the existing row rather than minting a second one.
  if (addOn.kind === "license") {
    if (hasLicense && !isRenewal) {
      return block(
        "ADDON_ALREADY_OWNED",
        `Your licence is already active. It renews on your anniversary.`,
      );
    }
    return null; // no ownership/redundancy checks apply to the licence
  }

  // 3) Credit packs are consumable, not entitlements: buying a second pack is
  // always meaningful.
  if (addOn.kind === "credit") return null;

  // 4) Already covered by the tenant's effective entitlements — paying again
  // buys nothing (DEF-1). A renewal is the one case where paying for something
  // you already have is the whole point.
  if (
    !isRenewal &&
    TenantMarketplaceService.isIncludedInEntitlements(addOn.grants, ent)
  ) {
    return block(
      "ADDON_ALREADY_GRANTED",
      `"${addOn.name}" is already active on your account.`,
    );
  }

  // 5) Capacity is quantity-based: owning one extra branch must not block
  // buying a second. Enforce the catalog ceiling instead.
  if (addOn.kind === "capacity") {
    const owned = isRenewal ? 0 : ownedQuantity;
    const wanted = owned + quantity;
    if (addOn.maxQuantity != null && wanted > addOn.maxQuantity) {
      return block(
        "ADDON_MAX_QUANTITY",
        `"${addOn.name}" is limited to ${addOn.maxQuantity} per account (you have ${owned}).`,
      );
    }
  } else if (isOwned && !isRenewal) {
    return block(
      "ADDON_ALREADY_OWNED",
      `"${addOn.name}" is already active for this account.`,
    );
  }

  // 6) Redundant capacity (DEF-8) — a limit.* grant whose effective limit is
  // already unlimited (-1) buys nothing.
  for (const key of Object.keys(addOn.grants ?? {})) {
    if (!key.startsWith("limit.")) continue;
    if (ent.limits?.[key] === -1) {
      return block(
        "ADDON_LIMIT_REDUNDANT",
        `"${addOn.name}" adds capacity you already have unlimited.`,
      );
    }
  }

  return null;
}
