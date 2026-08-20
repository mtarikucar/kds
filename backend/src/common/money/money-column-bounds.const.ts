/**
 * Precision/scale every money column in `schema.prisma` uses since the
 * Task 8 widening (see
 * prisma/migrations/20260820130000_widen_money_decimal_precision). Postgres
 * NUMERIC(precision, scale): `precision` total digits, `scale` of them after
 * the decimal point — so 14,2 leaves 12 integer digits.
 *
 * Excludes the 8 `Decimal(12, 2)` purchasing/GL columns, which this task
 * deliberately left alone (a separate, smaller inconsistency, not this
 * constant's job).
 */
export const MONEY_COLUMN_PRECISION = 14;
export const MONEY_COLUMN_SCALE = 2;

/**
 * Largest value a Decimal(14, 2) money column can hold: 12 nines then a
 * 2-digit fraction => 999,999,999,999.99.
 *
 * Round 1 of Task 8 widened every money column from Decimal(10, 2) (max
 * 99,999,999.99 — ~8,230 USD at 1 USD ≈ 12,150 UZS) to Decimal(14, 2)
 * specifically because that old ceiling was reachable by a single day's
 * turnover or a lifetime customer total in a low-unit-value currency. A
 * DTO-level @Max() on a money-shaped field that still hardcodes
 * 99_999_999.99 (or any other number not sourced from here) silently
 * defeats that widening on its own path: the column can hold the value,
 * the API refuses it.
 *
 * Import THIS constant for every such @Max() instead of retyping a number.
 * If the column precision ever changes again, update
 * MONEY_COLUMN_PRECISION / MONEY_COLUMN_SCALE and this literal together —
 * grep for `MONEY_COLUMN_MAX` to find every DTO that depends on it.
 */
export const MONEY_COLUMN_MAX = 999_999_999_999.99;
