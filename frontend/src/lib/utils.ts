import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistance } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// The platform collects in Turkish Lira only (PayTR is TRY-only), so money
// defaults to TRY and renders with Turkish grouping/decimals (₺2.999,00). A
// non-TRY `currency` is still honoured for the multi-currency code paths that
// remain (e.g. the bank-transfer/havale plan rendering) and for the tenants
// whose country profile is not TR.
//
// ─────────────────────────────────────────────────────────────────────────
// ONE SOURCE OF TRUTH FOR SYMBOL + PRECISION
//
// There are three money rails in this app and they used to disagree, so a
// currency was only ever right on whichever rail someone remembered to fix:
//   1. formatCurrency() below — the non-hook rail (QR menu, printing, ~15
//      other call sites), locale PINNED to tr-TR;
//   2. useFormatCurrency()/useFormatCurrencyExtended() — the admin/desktop
//      rail, which deliberately follows the VIEWER's locale for grouping;
//   3. lib/currency.ts — the billing/subscription rail, which deliberately
//      always places our own symbol in front of a tr-TR number because the
//      screens there pair the amount with an explicit ISO code.
// The LOCALE policy of each rail is deliberate and stays where it is. The
// SYMBOL and the DECIMAL COUNT are facts about the currency, not about the
// rail, so all three now read them from CURRENCY_DISPLAY: add a currency
// once and it is right on every screen.
// ─────────────────────────────────────────────────────────────────────────

/** How ONE currency is displayed, on every rail. */
export interface CurrencyDisplayRule {
  /** The symbol/word WE print whenever our code places the symbol itself. */
  symbol: string;
  /** Where that symbol sits when we place it: `₺1.234,00` vs `1.234 so'm`. */
  position: 'prefix' | 'suffix';
  /**
   * Display fraction digits, when the currency is quoted differently from
   * ISO-4217's default. `undefined` keeps ICU's own default, which is right
   * for TRY (2) and for the zero-decimal currencies (JPY, KRW) alike.
   * Storage/wire stays x100 for EVERY currency, always — this is display.
   */
  decimals?: number;
  /**
   * What the two Intl-currency-style rails (1 and 2) should do:
   *  - omitted    → ICU's narrow symbol is correct; use it.
   *  - 'code'     → force the ISO code because the "symbol" ICU would print
   *                 is not one a local reader recognises.
   *  - 'own-symbol' → ICU has nothing usable at all: format a plain number
   *                 and place `symbol` ourselves.
   */
  intl?: 'code' | 'own-symbol';
}

export const CURRENCY_DISPLAY: Record<string, CurrencyDisplayRule> = {
  TRY: { symbol: '₺', position: 'prefix' },
  USD: { symbol: '$', position: 'prefix' },
  EUR: { symbol: '€', position: 'prefix' },
  GBP: { symbol: '£', position: 'prefix' },
  // The disambiguated dollar signs are for the rail that places symbols
  // itself (lib/currency.ts). The two Intl rails print ICU's own narrow
  // symbol for these, which in most locales is a plain "$" — unchanged from
  // before this table existed, and not worth moving for a currency nothing
  // sells in.
  CAD: { symbol: 'C$', position: 'prefix' },
  AUD: { symbol: 'A$', position: 'prefix' },

  // Uzbek quotes the som by word, AFTER the amount ("50.000 so'm"), and
  // quotes it WHOLE — tiyin are not shown, even though ISO-4217 gives UZS
  // two decimals (matches the UZ country profile's displayDecimals: 0, see
  // backend/src/common/country/country-profile.const.ts). Neither Node's nor
  // Chromium's ICU carries a narrow symbol for UZS, so Intl's currency style
  // showed an Uzbek guest the bare ISO code, "UZS 50.000", instead of money.
  // There is no som sign in Unicode for UZS: U+20C0 is the KYRGYZ som.
  UZS: { symbol: "so'm", position: 'suffix', decimals: 0, intl: 'own-symbol' },

  // KGS is pinned to its ISO code ON PURPOSE. `currencyDisplay:'narrowSymbol'`
  // resolves KGS to U+20C0 ⃀, which is a combining-looking glyph most fonts
  // on our POS/tablet targets do not carry, so it renders as a box or as a
  // bare mark next to the number. No country profile defines KGS today (only
  // TR and UZ exist), so nothing reaches this entry — it is here so the
  // narrow symbol cannot arrive by accident the day one does.
  // BEFORE KYRGYZSTAN LAUNCHES: confirm the local convention (spelling,
  // placement, decimal count) with a Kyrgyz source and replace this entry.
  // Deliberately NOT guessing a Cyrillic spelling here.
  KGS: { symbol: 'KGS', position: 'prefix', intl: 'code' },
};

// The number locale is pinned for EVERY currency on rails 1 and 3, and it has
// to be a locale whose data is complete in every engine we render in. tr-TR
// is: it groups 50000 as "50.000" in Node and in Chromium alike. uz-UZ is NOT
// — measured off the same locale tag, Node gives "50 000" and Chromium gives
// "50,000". So the guest's own locale never picks the grouping; if it did, a
// jsdom-green test would still ship a wrong number to a phone.
export const MONEY_LOCALE = 'tr-TR';

// Building an Intl.NumberFormat is the expensive part (ICU data lookup), and a
// POS grid renders hundreds of prices per frame. The hook rail used to keep its
// own useMemo'd formatter; now that all three rails go through the two
// functions below, they share ONE cache instead. The key set is bounded by the
// (locale, currency, precision) triples we actually render.
const formatterCache = new Map<string, Intl.NumberFormat>();

function cachedFormatter(key: string, build: () => Intl.NumberFormat): Intl.NumberFormat {
  const hit = formatterCache.get(key);
  if (hit) return hit;
  // A throwing `build` (see the narrowSymbol fallback below) caches nothing,
  // so the fallback path gets its own key and its own entry.
  const built = build();
  formatterCache.set(key, built);
  return built;
}

/**
 * TEST ONLY. A cached formatter is built once and then never asks Intl
 * anything again, which would make a test that stubs Intl.NumberFormat (the
 * narrowSymbol/RangeError fallback) pass without ever reaching the stub. Tests
 * that care about construction call this first.
 */
export function resetCurrencyFormatterCache(): void {
  formatterCache.clear();
}

/**
 * Format a plain number in `locale` and place OUR symbol on it.
 *
 * This is rail 3's whole policy (lib/currency.ts), and rail 1/2's fallback
 * for a currency ICU cannot render (`intl: 'own-symbol'`). A currency with no
 * entry in CURRENCY_DISPLAY prints its ISO code as the symbol, which is the
 * honest fallback: better a readable code than a wrong glyph.
 */
export function formatCurrencyWithOwnSymbol(
  locale: string,
  amount: number,
  currency: string,
  fallbackDecimals = 2
): string {
  const rule = CURRENCY_DISPLAY[currency];
  // style:'decimal' has no currency-aware default precision of its own, so
  // spell it out — the caller's fallback, unless the currency is quoted
  // otherwise in the table above.
  const decimals = rule?.decimals ?? fallbackDecimals;
  const number = cachedFormatter(
    `d|${locale}|${decimals}`,
    () =>
      new Intl.NumberFormat(locale, {
        style: 'decimal',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
  ).format(amount);
  const symbol = rule?.symbol ?? currency;
  // A word or a code needs the separating space a glyph does not: "₺1.234,00"
  // but "1.234 so'm".
  return rule?.position === 'suffix' ? `${number} ${symbol}` : `${symbol}${number}`;
}

/**
 * Format money for an explicit locale, letting ICU own the symbol unless
 * CURRENCY_DISPLAY says it cannot be trusted for this currency.
 *
 * `fallbackDecimals` is the caller's own precision (rail 2 passes the tenant
 * country profile's displayDecimals); the table wins when it has an opinion,
 * because "so'm is quoted whole" is a fact about UZS and not about who is
 * looking at it. `undefined` leaves precision to ICU, which already gets the
 * zero-decimal currencies (JPY, KRW) right.
 */
export function formatCurrencyForLocale(
  locale: string,
  amount: number,
  currency: string,
  fallbackDecimals?: number
): string {
  const rule = CURRENCY_DISPLAY[currency];
  const decimals = rule?.decimals ?? fallbackDecimals;

  if (rule?.intl === 'own-symbol') {
    return formatCurrencyWithOwnSymbol(locale, amount, currency, decimals ?? 2);
  }

  const currencyOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    ...(decimals !== undefined
      ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
      : {}),
  };

  // Without this, a currency whose full symbol ICU spells as its ISO code in
  // some locales (RUB -> "RUB", not "₽") renders as letters. 'code' is for the
  // currencies whose narrow symbol we refuse (see KGS above).
  const currencyDisplay = rule?.intl === 'code' ? 'code' : 'narrowSymbol';

  try {
    return cachedFormatter(
      `c|${locale}|${currency}|${decimals}|${currencyDisplay}`,
      () => new Intl.NumberFormat(locale, { ...currencyOptions, currencyDisplay })
    ).format(amount);
  } catch {
    // 'narrowSymbol' arrived in Safari 14.1 / WebKitGTK 2.32, and an older
    // engine does not ignore the option — the CONSTRUCTOR throws RangeError.
    // Our web build targets es2020 and the Tauri shell targets safari13, so
    // such an engine is inside the supported set and an uncaught throw would
    // take down every price on the page. Take ICU's default display instead:
    // one currency loses its symbol, nobody loses the screen.
    return cachedFormatter(
      `c|${locale}|${currency}|${decimals}|default`,
      () => new Intl.NumberFormat(locale, currencyOptions)
    ).format(amount);
  }
}

/**
 * The non-hook money rail: locale pinned to tr-TR (see MONEY_LOCALE).
 *
 * Most of the app renders money through useFormatCurrency(), which reads
 * `displayDecimals` off the tenant's country profile; this plain function is
 * called from the many places that have no hook access, so precision comes
 * from CURRENCY_DISPLAY instead — the same table the hook consults first.
 */
export function formatCurrency(amount: number, currency: string = 'TRY'): string {
  return formatCurrencyForLocale(MONEY_LOCALE, amount, currency);
}

export function formatDate(date: string | Date, formatStr: string = 'PPP'): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return format(dateObj, formatStr);
}

export function formatDateTime(date: string | Date): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return format(dateObj, 'PPP p');
}

export function formatTimeAgo(date: string | Date): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return formatDistance(dateObj, new Date(), { addSuffix: true });
}

export function formatTime(date: string | Date): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return format(dateObj, 'p');
}

export function calculateOrderTotal(
  items: Array<{ quantity: number; price: number }>,
  discount: number = 0
): number {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  return subtotal - discount;
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    // Order statuses
    pending: 'bg-yellow-100 text-yellow-800',
    preparing: 'bg-blue-100 text-blue-800',
    ready: 'bg-green-100 text-green-800',
    served: 'bg-slate-100 text-slate-800',
    cancelled: 'bg-red-100 text-red-800',

    // Table statuses
    available: 'bg-green-100 text-green-800',
    occupied: 'bg-blue-100 text-blue-800',
    reserved: 'bg-yellow-100 text-yellow-800',

    // Payment statuses
    paid: 'bg-green-100 text-green-800',
    unpaid: 'bg-yellow-100 text-yellow-800',
    refunded: 'bg-red-100 text-red-800',
  };

  return colors[status.toLowerCase()] || 'bg-slate-100 text-slate-800';
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}

// KDS Urgency System
export type UrgencyLevel = 'fresh' | 'attention' | 'urgent' | 'critical';

export interface UrgencyStyles {
  border: string;
  badge: string;
  text: string;
  bg: string;
}

/**
 * Calculate urgency level based on order age
 * - < 5 min: fresh (green)
 * - 5-10 min: attention (amber)
 * - 10-15 min: urgent (orange)
 * - > 15 min: critical (red)
 */
export function getOrderUrgency(createdAt: string): UrgencyLevel {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const diffMinutes = (now - created) / 60000;

  if (diffMinutes < 5) return 'fresh';
  if (diffMinutes < 10) return 'attention';
  if (diffMinutes < 15) return 'urgent';
  return 'critical';
}

/**
 * Get Tailwind classes for urgency level styling
 */
export function getUrgencyStyles(urgency: UrgencyLevel): UrgencyStyles {
  switch (urgency) {
    case 'fresh':
      return {
        border: 'border-l-emerald-400',
        badge: 'bg-emerald-100 text-emerald-700',
        text: 'text-emerald-600',
        bg: 'bg-emerald-50',
      };
    case 'attention':
      return {
        border: 'border-l-amber-400',
        badge: 'bg-amber-100 text-amber-700',
        text: 'text-amber-600',
        bg: 'bg-amber-50',
      };
    case 'urgent':
      return {
        border: 'border-l-orange-500',
        badge: 'bg-orange-100 text-orange-700',
        text: 'text-orange-600',
        bg: 'bg-orange-50',
      };
    case 'critical':
      return {
        border: 'border-l-red-500',
        badge: 'bg-red-100 text-red-700',
        text: 'text-red-600',
        bg: 'bg-red-50',
      };
  }
}

/**
 * Sort orders by creation time (oldest first)
 */
export function sortOrdersByAge<T extends { createdAt: string }>(orders: T[]): T[] {
  return [...orders].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/**
 * Calculate elapsed time as formatted string (e.g., "5m 23s")
 */
export function getElapsedTime(createdAt: string): string {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const diffMs = now - created;
  const diffMins = Math.floor(diffMs / 60000);
  const diffSecs = Math.floor((diffMs % 60000) / 1000);

  if (diffMins > 0) {
    return `${diffMins}m ${diffSecs}s`;
  }
  return `${diffSecs}s`;
}

/**
 * Calculate average wait time from orders in milliseconds
 */
export function calculateAverageWaitTime(orders: Array<{ createdAt: string }>): number {
  if (orders.length === 0) return 0;

  const now = Date.now();
  const totalWait = orders.reduce((sum, order) => {
    return sum + (now - new Date(order.createdAt).getTime());
  }, 0);

  return totalWait / orders.length;
}

/**
 * Format milliseconds to display string (e.g., "5m 23s")
 */
export function formatWaitTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

/**
 * Count urgent orders (orders older than 10 minutes)
 */
export function countUrgentOrders(orders: Array<{ createdAt: string }>): number {
  return orders.filter(order => {
    const urgency = getOrderUrgency(order.createdAt);
    return urgency === 'urgent' || urgency === 'critical';
  }).length;
}
