import {
  MONEY_COLUMN_MAX,
  MONEY_COLUMN_PRECISION,
  MONEY_COLUMN_SCALE,
} from "./money-column-bounds.const";

describe("MONEY_COLUMN_MAX", () => {
  it("matches precision/scale: 12 integer digits, 2 fractional", () => {
    const integerDigits = MONEY_COLUMN_PRECISION - MONEY_COLUMN_SCALE;
    const expected = Number(
      `${"9".repeat(integerDigits)}.${"9".repeat(MONEY_COLUMN_SCALE)}`,
    );
    expect(MONEY_COLUMN_MAX).toBe(expected);
  });

  it("clears the old Decimal(10, 2) ceiling by four orders of magnitude", () => {
    // The bug this constant exists to prevent: a DTO @Max() still pinned to
    // the pre-Task-8 ceiling (99,999,999.99) would reject a value the
    // widened column can legally hold.
    expect(MONEY_COLUMN_MAX).toBeGreaterThan(99_999_999.99 * 1000);
  });
});
