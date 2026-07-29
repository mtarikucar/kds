import { describe, expect, it } from "vitest";
import { validateComboGroups } from "./comboValidation";
import type { ComboGroupInput } from "../../../types";

const item = (
  patch: Partial<ComboGroupInput["items"][number]> = {},
): ComboGroupInput["items"][number] => ({
  componentProductId: "prod-1",
  quantity: 1,
  priceDelta: 0,
  isDefault: false,
  ...patch,
});

const group = (patch: Partial<ComboGroupInput> = {}): ComboGroupInput => ({
  name: "İçeceğini Seç",
  minSelect: 1,
  maxSelect: 1,
  items: [item()],
  ...patch,
});

describe("validateComboGroups", () => {
  it("passes a well-formed slot", () => {
    expect(validateComboGroups([group()])).toEqual({});
  });

  it("passes an empty groups array (no slots is a backend-level concern)", () => {
    expect(validateComboGroups([])).toEqual({});
  });

  it("flags a blank slot name", () => {
    expect(validateComboGroups([group({ name: "  " })])).toEqual({
      0: ["menu.comboValidation.slotName"],
    });
  });

  it("flags a slot with no items (POS ComboValidationError at sale time)", () => {
    expect(validateComboGroups([group({ items: [] })])[0]).toContain(
      "menu.comboValidation.noItems",
    );
  });

  it("flags an unselected component product (empty id 400s the DTO)", () => {
    expect(
      validateComboGroups([
        group({ items: [item(), item({ componentProductId: "" })] }),
      ])[0],
    ).toEqual(["menu.comboValidation.itemProduct"]);
  });

  it("flags a cleared quantity (0 fails the DTO @Min(1))", () => {
    expect(
      validateComboGroups([group({ items: [item({ quantity: 0 })] })])[0],
    ).toEqual(["menu.comboValidation.itemQty"]);
  });

  it("flags a cleared maxSelect (0 fails the DTO @Min(1))", () => {
    const errors = validateComboGroups([group({ maxSelect: 0 })]);
    expect(errors[0]).toContain("menu.comboValidation.maxSelectMin");
    // minSelect 1 > maxSelect 0 is also unsatisfiable.
    expect(errors[0]).toContain("menu.comboValidation.minMax");
  });

  it("flags minSelect exceeding the item count (unsellable combo)", () => {
    expect(
      validateComboGroups([
        group({ minSelect: 2, maxSelect: 3, items: [item()] }),
      ])[0],
    ).toEqual(["menu.comboValidation.minMax"]);
  });

  it("flags minSelect exceeding maxSelect", () => {
    expect(
      validateComboGroups([
        group({ minSelect: 2, maxSelect: 1, items: [item(), item()] }),
      ])[0],
    ).toEqual(["menu.comboValidation.minMax"]);
  });

  it("keys errors by slot index and leaves valid slots out", () => {
    const errors = validateComboGroups([
      group(),
      group({ name: "", items: [] }),
    ]);
    expect(Object.keys(errors)).toEqual(["1"]);
    expect(errors[1]).toEqual([
      "menu.comboValidation.slotName",
      "menu.comboValidation.noItems",
    ]);
  });

  it("treats undefined quantity/min/max as their backend defaults (1)", () => {
    expect(
      validateComboGroups([
        group({
          minSelect: undefined,
          maxSelect: undefined,
          items: [item({ quantity: undefined })],
        }),
      ]),
    ).toEqual({});
  });
});
