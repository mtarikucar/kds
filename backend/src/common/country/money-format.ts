import { CountryProfile } from "./country-profile.const";

/**
 * The ONE server-side money formatter (Task 13). Every document the SERVER
 * itself renders — ESC/POS receipts, the Z-Report PDF, the Z-Report email —
 * used to hardcode `tr-TR` + 2 fraction digits (and, for the two z-reports
 * surfaces, a currency-symbol lookup that silently fell back to "$" for any
 * currency it didn't recognise, UZS included). The frontend's
 * `useFormatCurrency()` never reaches these server-rendered paths, so a UZS
 * tenant's receipt/report disagreed with their own screen about how many
 * decimals an amount has, and could print a dollar sign on a so'm report.
 *
 * Everything here is fed from the country profile's `currency` +
 * `displayDecimals` + `intlLocale` — never a hardcoded locale/decimal count
 * — mirroring frontend/src/hooks/useFormatCurrency.ts exactly: same
 * `Intl.NumberFormat` inputs (locale, style, currency, min/max fraction
 * digits) in, so the same rendered amount comes out on both sides.
 *
 * Two render shapes, not one function, because the CALLERS genuinely
 * differ in what they can print:
 *
 *  - `formatMoneyNumber` — grouped digits, no currency mark. Consumed by
 *    the ESC/POS receipt, which cannot print a Unicode currency glyph on a
 *    single-byte thermal codepage and instead appends its own ASCII-safe
 *    suffix (see `asciiCurrencySuffix`) — a pre-existing, deliberate
 *    convention (the ₺ glyph has no CP857 codepoint either) that this task
 *    preserves rather than breaks.
 *
 *  - `formatMoneyForDocument` — a full "symbol/suffix + number" string for
 *    documents that CAN print a real Unicode glyph (the Z-Report PDF via
 *    pdfkit, the Z-Report HTML email). This intentionally does NOT add
 *    `useFormatCurrency`'s locale thousands-grouping: T7's inventory named
 *    exactly two defects on these two surfaces — decimals hardcoded to 2,
 *    and the "$" fallback — never "missing grouping", and the global
 *    constraint for this task is that nothing may visibly change for a
 *    Turkish tenant. Turkish PDFs/emails today read "₺1234.56" (symbol
 *    prefix, ungrouped, 2dp); this keeps that exact shape byte-for-byte
 *    while giving every OTHER currency its own correct decimals and its
 *    own correct symbol/placement (derived from `Intl`, never guessed) —
 *    UZS becomes "150000 soʻm" (suffix, 0dp, the real "soʻm" glyph Intl
 *    produces) instead of "$150000.00".
 */

type DecimalLike = { toString(): string } | string | number;

function toSafeNumber(amount: DecimalLike): number {
  const n =
    typeof amount === "number" ? amount : Number.parseFloat(String(amount));
  return Number.isFinite(n) ? n : 0;
}

type MoneyFormatProfile = Pick<
  CountryProfile,
  "intlLocale" | "currency" | "displayDecimals"
>;

/**
 * Grouped, decimal-correct NUMBER only — no currency symbol/suffix. Locale
 * (grouping + decimal separator) and fraction-digit count both come from
 * the profile, never hardcoded. This is the piece a codepage-constrained
 * document (ESC/POS) can safely print.
 */
export function formatMoneyNumber(
  amount: DecimalLike,
  profile: Pick<MoneyFormatProfile, "intlLocale" | "displayDecimals">,
): string {
  const n = toSafeNumber(amount);
  return new Intl.NumberFormat(profile.intlLocale, {
    minimumFractionDigits: profile.displayDecimals,
    maximumFractionDigits: profile.displayDecimals,
  }).format(n);
}

/**
 * ASCII-safe currency mark for codepage-constrained documents that cannot
 * print a Unicode currency glyph (ESC/POS thermal receipts). "TL" is the
 * conventional fiş suffix for TRY (the ₺ glyph has no CP857 codepoint,
 * hence the pre-existing substitution this preserves); every other
 * currency falls back to its own ISO code — never a WRONG symbol, and
 * never a byte the codepage table can't encode (ISO codes are ASCII).
 */
export function asciiCurrencySuffix(currency: string): string {
  return currency === "TRY" ? "TL" : currency;
}

/**
 * Full "symbol/suffix + number" string for a document that CAN print a
 * real Unicode currency glyph (PDF, HTML email) but must not gain the
 * frontend's locale thousands-grouping — see the module doc comment for
 * why. The glyph itself and its placement (prefix vs suffix) are read off
 * `Intl.NumberFormat(..., { style: "currency" })` — the same source the
 * frontend hook uses — rather than a hand-maintained symbol map, so a
 * currency this hasn't been special-cased for still gets ITS OWN correct
 * symbol and placement instead of silently defaulting to "$" or "₺".
 */
export function formatMoneyForDocument(
  amount: DecimalLike,
  profile: MoneyFormatProfile,
): string {
  const n = toSafeNumber(amount);
  const digits = n.toFixed(profile.displayDecimals);

  // Probe placement/glyph with the non-negative magnitude — a negative
  // amount can reorder `Intl`'s parts (minus sign first), which would
  // otherwise flip whether `parts[0]` reads as the currency part. The
  // actual embedded sign always comes from `digits` above (toFixed keeps
  // it), matching the pre-existing "₺-5.00" shape these documents already
  // produced (symbol, then a signed number) — Intl's own negative layout
  // ("-₺5.00", sign before symbol) is a different, NOT pre-existing shape
  // this task must not introduce for TR.
  const parts = new Intl.NumberFormat(profile.intlLocale, {
    style: "currency",
    currency: profile.currency,
    minimumFractionDigits: profile.displayDecimals,
    maximumFractionDigits: profile.displayDecimals,
  }).formatToParts(Math.abs(n));
  const currencyMark =
    parts.find((p) => p.type === "currency")?.value ?? profile.currency;
  const isPrefix = parts[0]?.type === "currency";

  return isPrefix ? `${currencyMark}${digits}` : `${digits} ${currencyMark}`;
}
