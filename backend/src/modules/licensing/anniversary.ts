/**
 * Pure, framework-free anniversary + proration arithmetic for the à-la-carte
 * licensing model. Deliberately has NO Nest/Prisma imports — the same code
 * powers the quote engine, the renewal-cart generator, a UI mirror, and unit
 * tests without spinning up a module.
 *
 * The model in one paragraph: a tenant's paid License defines an immutable
 * *anniversary anchor* (the tenant-local calendar date it was first bought).
 * Every subsequent annual item is billed only for the days left until the next
 * anniversary, so the whole account renews on ONE date with ONE itemized
 * invoice.
 *
 * Two invariants everything else leans on:
 *
 *   1. All dates handled here are UTC-midnight *calendar dates*, never wall
 *      instants. Türkiye is UTC+3 with no DST, so a 10 Mar 01:00 TRT purchase
 *      is 09 Mar 22:00 UTC — storing the raw instant would put the anniversary
 *      on the 9th forever. `anchorDateFor` collapses an instant to the
 *      tenant-local calendar date exactly once, at write time; everything
 *      downstream is integer day arithmetic.
 *
 *   2. Rounding happens PER UNIT, then multiplies. `unitCents * qty ===
 *      subtotalCents` must hold exactly: the PayTR basket builder, the invoice
 *      PDF, and CheckoutService's 1-kuruş re-quote tolerance all depend on it.
 */

/** Türkiye — UTC+3, no DST. Overridable per tenant via `Tenant.timezone`. */
export const DEFAULT_TENANT_TZ = "Europe/Istanbul";

/**
 * Buying inside this window before the anniversary rolls the item into the
 * NEXT full cycle instead of selling a stub. A ₺990 module bought 2 days out
 * would cost ₺5,42, land on the renewal cart 48h later, and sit under PayTR's
 * minimum charge — a support ticket, not a sale.
 */
export const ROLL_FORWARD_THRESHOLD_DAYS = 14;

/** PayTR rejects zero-value baskets; never emit a priced line below ₺1. */
export const MIN_LINE_CENTS = 100;

const MS_PER_DAY = 86_400_000;

export interface ProrationResult {
  /** `full` = whole cycle, `prorated` = remainder only, `rollForward` = remainder + next cycle. */
  mode: "full" | "prorated" | "rollForward";
  /** GROSS (KDV-inclusive) price for ONE unit, already rounded. */
  unitCents: number;
  /** Always exactly `unitCents * quantity`. */
  subtotalCents: number;
  /** Days left in the CURRENT cycle. */
  remainingDays: number;
  /** Days this charge actually covers (differs from `remainingDays` on rollForward). */
  billedDays: number;
  /** Length of the current cycle — 365 or 366, never hardcoded. */
  cycleDays: number;
  periodStart: Date;
  periodEnd: Date;
  /** The resolved anchor — meaningful when the caller passed `null`. */
  anchorAt: Date;
}

export interface ProrateArgs {
  /** List price for one full cycle, in kuruş, KDV-inclusive. */
  annualPriceCents: number;
  /** The tenant's immutable anchor, or `null` when this purchase defines it. */
  anchorAt: Date | null;
  /** Frozen pricing instant. NEVER `new Date()` inline — settlement re-prices with this. */
  now: Date;
  quantity?: number;
  tz?: string;
}

/** UTC midnight of the calendar date `instant` falls on in `tz`. */
export function anchorDateFor(instant: Date, tz = DEFAULT_TENANT_TZ): Date {
  // en-CA formats as YYYY-MM-DD, which parses unambiguously.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

/** Strip the time component of an already-UTC calendar date. */
function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * The anniversary in `year`, clamping the anchor's day-of-month to the last
 * valid day. A 29 Feb anchor becomes 28 Feb in common years — never 1 March,
 * which would cross a month boundary and break "same day every year" for
 * invoice periods.
 */
function anniversaryIn(year: number, anchor: Date): Date {
  const month = anchor.getUTCMonth();
  const day = Math.min(anchor.getUTCDate(), daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

/**
 * The first anniversary strictly AFTER `from`. Buying on the anniversary
 * itself therefore yields a whole fresh cycle rather than a zero-day stub.
 */
export function nextAnniversary(anchorAt: Date, from: Date): Date {
  const today = utcMidnight(from);
  const anchor = utcMidnight(anchorAt);
  const candidate = anniversaryIn(today.getUTCFullYear(), anchor);
  return candidate.getTime() > today.getTime()
    ? candidate
    : anniversaryIn(today.getUTCFullYear() + 1, anchor);
}

/** The most recent anniversary at or before `from`. */
export function previousAnniversary(anchorAt: Date, from: Date): Date {
  const today = utcMidnight(from);
  const anchor = utcMidnight(anchorAt);
  const candidate = anniversaryIn(today.getUTCFullYear(), anchor);
  return candidate.getTime() <= today.getTime()
    ? candidate
    : anniversaryIn(today.getUTCFullYear() - 1, anchor);
}

/** Whole days between two UTC-midnight dates. Exact — UTC has no DST. */
export function daysBetweenUtc(a: Date, b: Date): number {
  return Math.round((utcMidnight(b).getTime() - utcMidnight(a).getTime()) / MS_PER_DAY);
}

export function prorate(args: ProrateArgs): ProrationResult {
  const { annualPriceCents, anchorAt, now, tz = DEFAULT_TENANT_TZ } = args;
  const quantity = args.quantity ?? 1;

  if (!Number.isInteger(annualPriceCents) || annualPriceCents < 0) {
    throw new RangeError(
      `annualPriceCents must be a non-negative integer, got ${annualPriceCents}`,
    );
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError(`quantity must be a positive integer, got ${quantity}`);
  }

  const today = anchorDateFor(now, tz);
  // A first purchase defines the anchor as today, which makes remainingDays
  // === cycleDays and prices the whole opening cart at full list price.
  const anchor = anchorAt ? utcMidnight(anchorAt) : today;

  const periodEndCurrent = nextAnniversary(anchor, today);
  const periodStartCurrent = previousAnniversary(anchor, today);
  const cycleDays = daysBetweenUtc(periodStartCurrent, periodEndCurrent);
  const remainingDays = daysBetweenUtc(today, periodEndCurrent);

  let mode: ProrationResult["mode"];
  let rawCents: number;
  let periodEnd: Date;
  let billedDays: number;

  if (remainingDays >= cycleDays) {
    mode = "full";
    rawCents = annualPriceCents;
    periodEnd = periodEndCurrent;
    billedDays = cycleDays;
  } else if (remainingDays <= ROLL_FORWARD_THRESHOLD_DAYS) {
    // Remainder at the CURRENT cycle's daily rate, plus one whole next cycle
    // at list price. Two clean terms beats one division across a boundary
    // where the two cycles can have different lengths.
    const periodEndNext = nextAnniversary(anchor, periodEndCurrent);
    const nextCycleDays = daysBetweenUtc(periodEndCurrent, periodEndNext);
    mode = "rollForward";
    rawCents =
      Math.round((annualPriceCents * remainingDays) / cycleDays) +
      annualPriceCents;
    periodEnd = periodEndNext;
    billedDays = remainingDays + nextCycleDays;
  } else {
    mode = "prorated";
    rawCents = Math.round((annualPriceCents * remainingDays) / cycleDays);
    periodEnd = periodEndCurrent;
    billedDays = remainingDays;
  }

  // A genuinely free item stays free; only a priced item gets floored.
  const unitCents =
    annualPriceCents === 0 ? 0 : Math.max(rawCents, MIN_LINE_CENTS);

  return {
    mode,
    unitCents,
    subtotalCents: unitCents * quantity,
    remainingDays,
    billedDays,
    cycleDays,
    periodStart: today,
    periodEnd,
    anchorAt: anchor,
  };
}
