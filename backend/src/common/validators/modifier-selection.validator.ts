import { BadRequestException } from "@nestjs/common";

/**
 * Shared ModifierGroup required/min/max enforcement for the order-build
 * paths. The customer QR path (CustomerOrdersService.validateAndCalculateItems)
 * and the staff POS path (OrdersService.createInner / update) must apply the
 * SAME modifier-group rules so a required group can't be skipped and a max
 * can't be exceeded depending on which channel rang the order.
 *
 * This is a PURE function over already-loaded data: callers eager-load the
 * product's modifierGroups → group(isActive) → modifiers{id, isAvailable}
 * and pass the selected modifier ids per line. It mirrors the inline logic in
 * customer-orders.service.ts (validateAndCalculateItems). Keep the two in
 * lockstep — if you change one, change the other.
 *
 * Enforced rules per active group on a product:
 *  - belongs-to-product: every selected modifier id must be in the union of
 *    the product's ACTIVE groups' AVAILABLE modifiers.
 *  - required / min: when isRequired or minSelections>0, at least
 *    max(isRequired?1:0, minSelections) selections from that group.
 *  - max: when maxSelections is a positive number, at most maxSelections
 *    selections from that group (null / <=0 == unbounded — schema maxSelections
 *    is Int?).
 */

export interface ModifierSelectionGroup {
  isActive: boolean;
  isRequired: boolean;
  minSelections: number;
  /** Int? in schema — null means "no upper bound". */
  maxSelections: number | null;
  displayName: string;
  /** Available modifiers belonging to this group. */
  modifiers: { id: string }[];
}

export interface ModifierSelectionProduct {
  name: string;
  /**
   * Junction rows: each carries the group with its (filtered) modifiers.
   * Optional so callers that don't eager-load it (and products with no
   * configured groups) are treated as "no constraints" rather than crashing.
   */
  modifierGroups?: { group: ModifierSelectionGroup }[];
}

/**
 * Validate a single line's selected modifier ids against its product's
 * configured groups. Throws BadRequestException (→ HTTP 400) on the first
 * violation, matching the customer path's behaviour and message style.
 */
export function validateModifierSelections(
  product: ModifierSelectionProduct,
  selectedModifierIds: string[],
): void {
  const productModifierGroups = product.modifierGroups ?? [];

  // 1) belongs-to-product: union of all ACTIVE groups' available modifiers.
  const allowedModifierIds = new Set<string>();
  for (const pmg of productModifierGroups) {
    if (!pmg.group.isActive) continue;
    for (const m of pmg.group.modifiers) allowedModifierIds.add(m.id);
  }
  for (const id of selectedModifierIds) {
    if (!allowedModifierIds.has(id)) {
      throw new BadRequestException(
        `Modifier ${id} is not allowed on product "${product.name}"`,
      );
    }
  }

  // 2) per-group required/min/max.
  for (const pmg of productModifierGroups) {
    const group = pmg.group;
    if (!group.isActive) continue;
    const groupModifierIds = group.modifiers.map((m) => m.id);
    const selectedCount = selectedModifierIds.filter((id) =>
      groupModifierIds.includes(id),
    ).length;

    if (group.isRequired || group.minSelections > 0) {
      const minRequired = group.isRequired
        ? Math.max(1, group.minSelections)
        : group.minSelections;
      if (selectedCount < minRequired) {
        throw new BadRequestException(
          `Product "${product.name}" requires at least ${minRequired} selection(s) from "${group.displayName}"`,
        );
      }
    }

    // maxSelections is Int? — null/<=0 means unbounded.
    if (
      group.maxSelections != null &&
      group.maxSelections > 0 &&
      selectedCount > group.maxSelections
    ) {
      throw new BadRequestException(
        `Product "${product.name}" allows at most ${group.maxSelections} selection(s) from "${group.displayName}"`,
      );
    }
  }
}
