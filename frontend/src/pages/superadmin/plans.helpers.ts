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

// ──────────────────────────────────────────────────────────────────────────
// DEMO-plan lock (review F2)
// ──────────────────────────────────────────────────────────────────────────

/**
 * FE mirror of backend `DEMO_PLAN_NAME` (backend/src/modules/demo/
 * demo.constants.ts). DemoGuardService keys the demo tenant's real-money
 * block on `currentPlan.name === "DEMO"` and fails OPEN, so the name is a
 * security invariant: the backend refuses renaming/deleting this plan and
 * assigning it to non-demo tenants; the UI locks the same actions up front.
 */
export const DEMO_PLAN_NAME = 'DEMO';

export function isDemoPlan(plan: { name?: string | null }): boolean {
  return plan?.name === DEMO_PLAN_NAME;
}

// ──────────────────────────────────────────────────────────────────────────
// Plan amount preview (review F3)
// ──────────────────────────────────────────────────────────────────────────

export interface DiscountablePlanLike {
  monthlyPrice: number | string;
  yearlyPrice?: number | string;
  discountPercentage?: number | null;
  discountStartDate?: string | null;
  discountEndDate?: string | null;
  isDiscountActive?: boolean | null;
}

/**
 * FE mirror of the backend's `resolvePlanAmount` (backend/src/modules/
 * subscriptions/plan-pricing.helper.ts): the discounted (or full) gross
 * amount for a billing cycle, honoring the plan's time-boxed promotional
 * discount window. Used to PREVIEW the post-change billing amount in the
 * superadmin plan-change modal — the backend recomputes the authoritative
 * value on the same rule when the change is applied.
 */
export function resolvePlanAmountForCycle(
  plan: DiscountablePlanLike,
  billingCycle: string,
  now: Date = new Date(),
): number {
  const base = Number(
    billingCycle === 'YEARLY' ? (plan.yearlyPrice ?? plan.monthlyPrice) : plan.monthlyPrice,
  );
  const discountActive = !!(
    plan.isDiscountActive &&
    plan.discountPercentage &&
    plan.discountStartDate &&
    plan.discountEndDate &&
    new Date(plan.discountStartDate) <= now &&
    new Date(plan.discountEndDate) >= now
  );
  if (!discountActive) return base;
  return Math.round(base * (1 - plan.discountPercentage! / 100) * 100) / 100;
}
