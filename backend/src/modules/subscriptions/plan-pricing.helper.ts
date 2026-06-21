import { Prisma } from "@prisma/client";

/**
 * Single source of truth for what a plan ACTUALLY costs right now.
 *
 * A plan can carry a time-boxed promotional discount (discountPercentage within
 * [discountStartDate, discountEndDate] while isDiscountActive). getAvailablePlans
 * advertised the discounted price (strikethrough + "% off" badge) but EVERY
 * charge rail (createSubscription / startTrial / applyUpgrade / confirmDowngrade,
 * checkout quote, havale bank-transfer, create-intent) charged the full gross —
 * overcharging the buyer versus the displayed offer whenever a discount was
 * live. Routing all rails through this helper makes the advertised price the
 * price charged.
 */
export interface DiscountablePlan {
  monthlyPrice: Prisma.Decimal | number | string;
  yearlyPrice: Prisma.Decimal | number | string;
  discountPercentage?: number | null;
  discountStartDate?: Date | null;
  discountEndDate?: Date | null;
  isDiscountActive?: boolean | null;
}

export function isPlanDiscountActive(
  plan: DiscountablePlan,
  now: Date = new Date(),
): boolean {
  return !!(
    plan.isDiscountActive &&
    plan.discountPercentage &&
    plan.discountStartDate &&
    plan.discountEndDate &&
    plan.discountStartDate <= now &&
    plan.discountEndDate >= now
  );
}

/** Discounted (or full) gross amount for the billing cycle, rounded to 2dp. */
export function resolvePlanAmount(
  plan: DiscountablePlan,
  billingCycle: string,
  now: Date = new Date(),
): Prisma.Decimal {
  const base = new Prisma.Decimal(
    billingCycle === "YEARLY" ? plan.yearlyPrice : plan.monthlyPrice,
  );
  if (!isPlanDiscountActive(plan, now)) {
    return base.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }
  const multiplier = new Prisma.Decimal(100 - plan.discountPercentage!).div(
    100,
  );
  return base.mul(multiplier).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
