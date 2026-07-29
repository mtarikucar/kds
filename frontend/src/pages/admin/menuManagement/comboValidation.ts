import type { ComboGroupInput } from "../../../types";

/** i18n keys (menu namespace) of the failures, grouped by slot index. */
export type ComboSlotErrors = Record<number, string[]>;

/**
 * Client-side pre-submit validation for combo slots. The backend DTO only
 * checks minSelect<=maxSelect / ownership / no-nesting — it happily persists
 * a combo with an empty slot or fewer items than minSelect, which then throws
 * ComboValidationError at SALE time on the POS. It also 400s on the raw DTO
 * constraints a cleared field produces (quantity 0, maxSelect 0, empty
 * componentProductId), surfacing only as an opaque backend toast. Mirror all
 * of that here so the editor blocks with inline, per-slot messages instead.
 */
export function validateComboGroups(
  groups: ComboGroupInput[],
): ComboSlotErrors {
  const errors: ComboSlotErrors = {};
  groups.forEach((group, gi) => {
    const slotErrors: string[] = [];
    const minSelect = group.minSelect ?? 1;
    const maxSelect = group.maxSelect ?? 1;

    if (!group.name.trim()) {
      slotErrors.push("menu.comboValidation.slotName");
    }
    if (group.items.length === 0) {
      slotErrors.push("menu.comboValidation.noItems");
    }
    if (group.items.some((it) => !it.componentProductId)) {
      slotErrors.push("menu.comboValidation.itemProduct");
    }
    if (group.items.some((it) => (it.quantity ?? 1) < 1)) {
      slotErrors.push("menu.comboValidation.itemQty");
    }
    if (maxSelect < 1) {
      slotErrors.push("menu.comboValidation.maxSelectMin");
    }
    // A slot is only satisfiable at sale time when minSelect fits within both
    // maxSelect and the number of selectable items.
    if (
      minSelect > maxSelect ||
      (group.items.length > 0 && minSelect > group.items.length)
    ) {
      slotErrors.push("menu.comboValidation.minMax");
    }

    if (slotErrors.length > 0) errors[gi] = slotErrors;
  });
  return errors;
}
