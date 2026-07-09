/**
 * Purchasing unit-of-measure conversion. An item is stocked/consumed in a base
 * unit (PCS) but bought in a purchase unit (BOX). `factor` = base units per 1
 * purchase unit (a BOX of 12 → 12). A null/zero/1 factor means the item is
 * bought in its base unit (no packaging).
 */
function normFactor(factor: number | null | undefined): number {
  return factor && factor > 0 ? factor : 1;
}

/** Base units contained in `purchaseQty` purchase units. */
export function purchaseToBase(
  purchaseQty: number,
  factor: number | null | undefined,
): number {
  return purchaseQty * normFactor(factor);
}

/** Whole purchase packs needed to cover a base-unit requirement (rounded up). */
export function baseToPurchasePacks(
  baseQty: number,
  factor: number | null | undefined,
): number {
  return Math.ceil(baseQty / normFactor(factor));
}
