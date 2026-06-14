// Pure helper extracted (verbatim) from PlansPage so it can be unit-tested in
// isolation. The component re-imports it at the original call site, so runtime
// behavior is byte-identical.

// Apply a percentage discount to a monthly price. Mirrors the inline
// `Number(plan.monthlyPrice) * (1 - plan.discountPercentage / 100)` expression
// (the component then formats the result via toLocaleString).
export function discountedMonthlyPrice(
  monthlyPrice: number | string,
  discountPercentage: number,
): number {
  return Number(monthlyPrice) * (1 - discountPercentage / 100);
}
