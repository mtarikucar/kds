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
 *
 * The z-report and split-bill cases below were updated for Task 8 (multi-
 * country architecture, money-column widening): those two @Max bounds used
 * to be pinned to the pre-widening Decimal(10,2) ceiling (99,999,999.99),
 * which meant the API rejected a value its own column could already hold —
 * on exactly the path (a UZS restaurant's daily cash total) the widening
 * exists for. They now source from MONEY_COLUMN_MAX
 * (common/money/money-column-bounds.const.ts), so each has both an
 * "accepts what changed" and a "still rejects the genuinely absurd" case.
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

  it("z-report: accepts a cash amount above the old Decimal(10,2) ceiling", async () => {
    // 100,000,000 was rejected by the pre-Task-8 CASH_MAX (99,999,999.99).
    // The column is Decimal(14, 2) now; the DTO bound must not be narrower
    // than what it actually writes to.
    const ok = await constraintsOf(CreateZReportDto, {
      reportDate: "2026-06-21",
      cashDrawerOpening: 100_000_000,
      cashDrawerClosing: 0,
    });
    expect(ok.some((m) => /cashDrawerOpening/i.test(m))).toBe(false);
  });

  it("z-report: still rejects a cash amount beyond the Decimal(14,2) column", async () => {
    const over = await constraintsOf(CreateZReportDto, {
      reportDate: "2026-06-21",
      cashDrawerOpening: 1_000_000_000_000, // exceeds 999,999,999,999.99
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

  it("split bill: accepts a single payment amount above the old Decimal(10,2) ceiling", async () => {
    // Same overflow-vs-column bug as the z-report case: 100,000,000 was
    // rejected by the pre-Task-8 @Max(99_999_999.99) on SplitPaymentEntry.
    // Payment.amount is Decimal(14, 2); a single large split (e.g. a big
    // banquet bill settled in one card payment) must not be blocked.
    const ok = await constraintsOf(SplitBillDto, {
      splitType: SplitType.CUSTOM,
      payments: [{ amount: 100_000_000, method: "CASH" }],
    });
    expect(ok.some((m) => /amount/i.test(m))).toBe(false);
  });

  it("split bill: still rejects a genuinely absurd payment amount", async () => {
    const over = await constraintsOf(SplitBillDto, {
      splitType: SplitType.CUSTOM,
      payments: [{ amount: 1_000_000_000_000, method: "CASH" }], // exceeds 999,999,999,999.99
    });
    expect(over.some((m) => /amount/i.test(m))).toBe(true);
  });
});
