import {
  CREDIT_KINDS,
  LICENSE_PRODUCT_CODE,
  isCreditKind,
  isKnownGrantKey,
} from "../entitlements/entitlement-keys.const";

/**
 * Pure catalog invariants for MarketplaceAddOn rows.
 *
 * Before v3.3.0 the catalog was deliberately permissive: `AddOnCatalogService`
 * documented that it "does NOT validate that grants keys match the entitlement
 * key namespace", deferring to the projector. That was defensible while the
 * catalog was a 14-row seed file edited by developers. It stops being
 * defensible once à-la-carte makes the catalog the ONLY thing standing between
 * a superadmin's JSON blob and what a paying tenant receives.
 *
 * The permissive policy has already cost real money twice:
 *   - `extra_branch` granted `limit.branches` while every consumer read
 *     `limit.maxBranches`. Tenants paid ₺399/mo for a branch cap that never
 *     rose (fixed in 20260722130000_fix_extra_branch_grant).
 *   - `limit.kdsScreens`, `limit.kdsStations` and `limit.tablets` are granted
 *     by three published add-ons to this day and read by nothing at all.
 *
 * Both are typos-that-validate. This module rejects them at write time.
 */

export const ADDON_KINDS = [
  "license",
  "module",
  "integration",
  "capacity",
  "credit",
  "service",
] as const;

export const ADDON_BILLINGS = ["annual", "oneTime"] as const;
export const ADDON_STATUSES = ["draft", "published", "archived"] as const;

export type AddOnKind = (typeof ADDON_KINDS)[number];
export type AddOnBilling = (typeof ADDON_BILLINGS)[number];
export type AddOnStatus = (typeof ADDON_STATUSES)[number];

export interface CatalogRowShape {
  code: string;
  kind: string;
  billing: string;
  priceCents: number;
  status: string;
  grants: Record<string, unknown>;
  deps: string[];
  requiresLicense?: boolean;
  creditKind?: string | null;
  creditUnits?: number | null;
  maxQuantity?: number | null;
}

/** Re-exported for catalog-side callers; defined in the neutral vocabulary. */
export const LICENSE_ADDON_CODE = LICENSE_PRODUCT_CODE;

function grantKeysWithPrefix(
  grants: Record<string, unknown>,
  prefix: string,
): string[] {
  return Object.keys(grants).filter((k) => k.startsWith(`${prefix}.`));
}

/**
 * Returns a list of human-readable problems. Empty means the row is valid.
 * Deliberately returns ALL problems rather than throwing on the first, so the
 * superadmin UI can show every issue in one pass.
 */
export function validateCatalogRow(row: CatalogRowShape): string[] {
  const problems: string[] = [];
  const grants = row.grants ?? {};

  if (!(ADDON_KINDS as readonly string[]).includes(row.kind)) {
    problems.push(
      `kind must be one of ${ADDON_KINDS.join("|")}, got "${row.kind}"`,
    );
  }
  if (!(ADDON_BILLINGS as readonly string[]).includes(row.billing)) {
    problems.push(
      `billing must be one of ${ADDON_BILLINGS.join("|")}, got "${row.billing}"`,
    );
  }
  if (!(ADDON_STATUSES as readonly string[]).includes(row.status)) {
    problems.push(
      `status must be one of ${ADDON_STATUSES.join("|")}, got "${row.status}"`,
    );
  }

  // --- grant keys + value shapes -------------------------------------------
  for (const [key, value] of Object.entries(grants)) {
    if (!isKnownGrantKey(key)) {
      problems.push(
        `unknown grant key "${key}" — nothing in the system reads it, so this ` +
          `product would take money and grant nothing`,
      );
      continue;
    }
    const prefix = key.slice(0, key.indexOf("."));
    if (prefix === "feature" && typeof value !== "boolean") {
      problems.push(`grant "${key}" must be a boolean, got ${typeof value}`);
    }
    if (prefix === "limit") {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        problems.push(`grant "${key}" must be an integer`);
      } else if (value !== -1 && value <= 0) {
        problems.push(
          `grant "${key}" must be a positive count or -1 (unlimited), got ${value}`,
        );
      }
    }
    if (prefix === "integration") {
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.some((v) => typeof v !== "string" || v.length === 0)
      ) {
        problems.push(
          `grant "${key}" must be a non-empty array of vendor id strings`,
        );
      }
    }
    if (prefix === "credit") {
      problems.push(
        `grant "${key}" is not allowed: credits are prepaid balances, not ` +
          `entitlements. Use kind:'credit' with creditKind/creditUnits.`,
      );
    }
  }

  // --- deps -----------------------------------------------------------------
  for (const dep of row.deps ?? []) {
    if (dep.startsWith("plan:")) {
      problems.push(
        `dep "${dep}" references a subscription plan. Plans are retired — ` +
          `such a dep can never be satisfied and would block every purchase.`,
      );
    }
    if (dep === row.code) {
      problems.push(`dep "${dep}" cannot reference the product itself`);
    }
  }

  // --- per-kind rules -------------------------------------------------------
  switch (row.kind) {
    case "license":
      if (row.code !== LICENSE_ADDON_CODE) {
        problems.push(
          `kind:'license' is a singleton and must use code "${LICENSE_ADDON_CODE}"`,
        );
      }
      if (grants["feature.license"] !== true) {
        problems.push(`kind:'license' must grant { "feature.license": true }`);
      }
      if (row.requiresLicense !== false) {
        problems.push(
          `kind:'license' must set requiresLicense=false — the license cannot ` +
            `require itself`,
        );
      }
      if (row.billing !== "annual") {
        problems.push(`kind:'license' must be billed annually`);
      }
      break;

    case "module":
      if (grantKeysWithPrefix(grants, "feature").length === 0) {
        problems.push(`kind:'module' must grant at least one feature.* key`);
      }
      break;

    case "integration":
      if (grantKeysWithPrefix(grants, "integration").length === 0) {
        problems.push(
          `kind:'integration' must grant at least one integration.* key`,
        );
      }
      break;

    case "capacity":
      if (grantKeysWithPrefix(grants, "limit").length === 0) {
        problems.push(`kind:'capacity' must grant at least one limit.* key`);
      }
      if (row.maxQuantity != null && row.maxQuantity < 1) {
        problems.push(`maxQuantity must be >= 1 when set`);
      }
      break;

    case "credit":
      if (!isCreditKind(row.creditKind)) {
        problems.push(
          `kind:'credit' requires creditKind to be one of ${CREDIT_KINDS.join("|")}`,
        );
      }
      if (
        row.creditUnits == null ||
        !Number.isInteger(row.creditUnits) ||
        row.creditUnits < 1
      ) {
        problems.push(`kind:'credit' requires a positive integer creditUnits`);
      }
      if (Object.keys(grants).length > 0) {
        problems.push(
          `kind:'credit' must not carry entitlement grants — a credit pack ` +
            `tops up a balance, it does not unlock a feature`,
        );
      }
      if (row.billing !== "oneTime") {
        problems.push(
          `kind:'credit' must be oneTime — credits are valid until consumed, ` +
            `not for a period`,
        );
      }
      break;

    case "service":
      if (row.billing !== "oneTime") {
        problems.push(`kind:'service' must be oneTime`);
      }
      break;
  }

  // Credit/service rows are bought outright and must not be gated on a
  // license the buyer may not need.
  if (
    (row.kind === "credit" || row.kind === "service") &&
    row.requiresLicense === true
  ) {
    problems.push(
      `kind:'${row.kind}' must set requiresLicense=false — it is not a ` +
        `licensed capability`,
    );
  }

  // --- money ----------------------------------------------------------------
  if (!Number.isInteger(row.priceCents) || row.priceCents < 0) {
    problems.push(`priceCents must be a non-negative integer`);
  }
  if (row.status === "published" && row.priceCents <= 0) {
    // TenantMarketplaceService.purchase() lets a priceCents===0 row through
    // WITHOUT a paymentRef (that is how operator comps and promos work).
    // Publishing a zero-price row therefore hands it to every tenant for free.
    problems.push(
      `a published product must have priceCents > 0 — a zero price bypasses ` +
        `the payment guard and grants the product to everyone for free`,
    );
  }

  return problems;
}
