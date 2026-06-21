import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateIngredientMovementDto } from "./create-ingredient-movement.dto";
import { CreateStockItemDto } from "./create-stock-item.dto";
import { CreateZReportDto } from "../../z-reports/dto/create-z-report.dto";
import { SplitBillDto, SplitType } from "../../orders/dto/split-bill.dto";

/**
 * Wave-3 hardening: numeric DTO fields that write to fixed-precision Decimal
 * columns now carry @Max bounds (and arrays carry @ArrayMaxSize), so an
 * oversized input fails with a clean 400 instead of a Postgres overflow 500.
 */
async function constraintsOf(
  cls: any,
  input: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(cls, input) as object;
  const errors = await validate(dto);
  // Flatten nested (e.g. array element) constraints too.
  const walk = (es: any[]): string[] =>
    es.flatMap((e) => [
      ...Object.values(e.constraints ?? {}),
      ...walk(e.children ?? []),
    ]) as string[];
  return walk(errors);
}

describe("Decimal/array DTO bounds (Wave-3)", () => {
  it("ingredient movement: rejects an over-precision/oversized quantity and negative cost", async () => {
    const over = await constraintsOf(CreateIngredientMovementDto, {
      stockItemId: "s1",
      type: "IN",
      quantity: 99_999_999,
    });
    expect(over.some((m) => /quantity/i.test(m))).toBe(true);

    const negCost = await constraintsOf(CreateIngredientMovementDto, {
      stockItemId: "s1",
      type: "IN",
      quantity: 1,
      costPerUnit: -5,
    });
    expect(negCost.some((m) => /costPerUnit/i.test(m))).toBe(true);

    const ok = await constraintsOf(CreateIngredientMovementDto, {
      stockItemId: "s1",
      type: "IN",
      quantity: 10,
      costPerUnit: 2.5,
    });
    expect(ok).toEqual([]);
  });

  it("stock item: rejects a currentStock beyond the Decimal(10,3) column", async () => {
    const over = await constraintsOf(CreateStockItemDto, {
      name: "Flour",
      unit: "KG",
      currentStock: 10_000_000,
    });
    expect(over.some((m) => /currentStock/i.test(m))).toBe(true);
  });

  it("z-report: rejects cash amounts beyond the Decimal(10,2) column", async () => {
    const over = await constraintsOf(CreateZReportDto, {
      reportDate: "2026-06-21",
      cashDrawerOpening: 100_000_000,
      cashDrawerClosing: 0,
    });
    expect(over.some((m) => /cashDrawerOpening/i.test(m))).toBe(true);
  });

  it("split bill: rejects a payments array beyond the cap", async () => {
    const payments = Array.from({ length: 201 }, () => ({
      amount: 1,
      method: "CASH",
    }));
    const over = await constraintsOf(SplitBillDto, {
      splitType: SplitType.CUSTOM,
      payments,
    });
    expect(over.some((m) => /payments/i.test(m))).toBe(true);
  });
});
