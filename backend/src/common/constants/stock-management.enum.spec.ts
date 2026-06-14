import {
  StockUnit,
  IngredientMovementType,
  PurchaseOrderStatus,
  WasteReason,
  StockCountStatus,
} from "./stock-management.enum";

/**
 * Long-tail drift-guard for inventory-domain enums. Values are persisted
 * and matched against Prisma enums; we pin value===name so a typo can't
 * silently break serialization, and assert the directional movement types
 * exist (a missing reversal type would break PO-cancel stock recovery).
 */
describe("stock-management enums", () => {
  const valueEqualsName = (e: Record<string, string>) =>
    Object.entries(e).forEach(([name, value]) => expect(value).toBe(name));

  it("uses value===name for every inventory enum", () => {
    valueEqualsName(StockUnit);
    valueEqualsName(IngredientMovementType);
    valueEqualsName(PurchaseOrderStatus);
    valueEqualsName(WasteReason);
    valueEqualsName(StockCountStatus);
  });

  it("keeps the load-bearing reversal/deduction movement types", () => {
    expect(IngredientMovementType.ORDER_DEDUCTION).toBe("ORDER_DEDUCTION");
    expect(IngredientMovementType.ORDER_REVERSAL).toBe("ORDER_REVERSAL");
    expect(IngredientMovementType.PO_CANCEL_REVERSAL).toBe(
      "PO_CANCEL_REVERSAL",
    );
  });
});
