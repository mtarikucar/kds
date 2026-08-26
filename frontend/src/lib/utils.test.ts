import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateAverageWaitTime,
  calculateOrderTotal,
  countUrgentOrders,
  formatCurrency,
  formatWaitTime,
  getElapsedTime,
  getOrderUrgency,
  getStatusColor,
  getUrgencyStyles,
  sortOrdersByAge,
  truncate,
} from './utils';

// The platform collects in TRY only (PayTR is TRY-only); the money formatter
// must default to Turkish Lira, never US dollars. A USD default here used to
// leak "$" onto TRY storefronts (QR menu) — the exact bug this guards.
describe('formatCurrency', () => {
  it('defaults to Turkish Lira when no currency is given', () => {
    expect(formatCurrency(19.5)).toBe('₺19,50');
  });

  it('groups thousands the Turkish way', () => {
    expect(formatCurrency(2999)).toBe('₺2.999,00');
  });

  it('still honours an explicit non-TRY currency (multi-currency capability kept)', () => {
    expect(formatCurrency(100, 'USD')).toBe('$100,00');
  });

  // Task 7 (multi-country): UZS quotes so'm WHOLE — zero decimals — even
  // though ISO-4217 gives it two (see country-profile.const.ts). This
  // ad-hoc formatter is a legacy path (most of the app renders money
  // through useFormatCurrency(), which reads displayDecimals off the
  // tenant's country profile); it doesn't have hook access, so it carries
  // its own small override here rather than silently mis-rendering UZS
  // with two decimals like every other currency.
  it("renders UZS whole (so'm has no decimals) while TRY/USD keep theirs — unaffected", () => {
    expect(formatCurrency(1234567.89, 'UZS')).toBe("1.234.568 so'm");
  });

  // No ICU locale can render a so'm symbol — neither Node nor Chromium has a
  // narrow symbol for UZS, so Intl's currency style prints the bare ISO code
  // ("UZS\u00a01.234.568") to an Uzbek guest. Measured in both engines. So the
  // symbol is OURS, not ICU's, for the currencies in CURRENCY_SYMBOL_OVERRIDE.
  it('prints the som word for UZS instead of the bare ISO code', () => {
    expect(formatCurrency(50000, 'UZS')).toBe("50.000 so'm");
    expect(formatCurrency(50000, 'UZS')).not.toContain('UZS');
  });

  // The number locale stays pinned to tr-TR for EVERY currency, UZS included.
  // uz-UZ grouping is not portable: off the same locale tag Node renders 50000
  // as "50\u00a0000" and Chromium as "50,000", so an assertion on it would pass
  // in jsdom and still ship wrong. tr-TR is byte-identical in both engines.
  it('groups UZS the same way it groups TRY (portable locale)', () => {
    expect(formatCurrency(50000, 'UZS')).toContain('50.000');
  });

  // ~15 non-QR call sites render TRY through this helper. currencyDisplay
  // 'narrowSymbol' is on the Intl path so a non-Turkish UI locale can never
  // downgrade "₺" to "TRY"; these pin that TRY did not move a byte.
  it('keeps the TRY rendering byte-identical (the call sites depend on it)', () => {
    expect(formatCurrency(0, 'TRY')).toBe('₺0,00');
    expect(formatCurrency(1234567.89, 'TRY')).toBe('₺1.234.567,89');
    expect(formatCurrency(-19.5, 'TRY')).toBe('-₺19,50');
  });

  // `currencyDisplay: 'narrowSymbol'` landed in Safari 14.1 / WebKitGTK 2.32,
  // and an engine older than that does not ignore the option — it throws
  // RangeError from the CONSTRUCTOR. Our web build targets es2020 (Safari
  // 13.1) and the Tauri shell targets safari13, so that engine is inside the
  // supported set, and an uncaught throw here takes down every price on the
  // page — a white screen at the table. Fall back to ICU's default display.
  it('still renders money on an engine that rejects narrowSymbol', () => {
    const real = Intl.NumberFormat;
    const spy = vi
      .spyOn(Intl, 'NumberFormat')
      .mockImplementation(((locale?: string, options?: Intl.NumberFormatOptions) => {
        if (options?.currencyDisplay === 'narrowSymbol') {
          throw new RangeError(
            "invalid value narrowSymbol for option currencyDisplay",
          );
        }
        return new real(locale, options);
      }) as unknown as typeof Intl.NumberFormat);

    try {
      expect(formatCurrency(2999, 'TRY')).toBe('₺2.999,00');
      // The override path never asks for a currency style at all, so it is
      // unaffected either way.
      expect(formatCurrency(50000, 'UZS')).toBe("50.000 so'm");
    } finally {
      spy.mockRestore();
    }
  });
});

// A fixed "now" makes every Date.now()-based helper deterministic.
const NOW = new Date('2026-06-14T12:00:00.000Z').getTime();

/** Build an ISO timestamp `minutes` (and optional `seconds`) before NOW. */
function isoAgo(minutes: number, seconds = 0): string {
  return new Date(NOW - minutes * 60_000 - seconds * 1_000).toISOString();
}

describe('calculateOrderTotal', () => {
  it('sums quantity * price across line items', () => {
    expect(
      calculateOrderTotal([
        { quantity: 2, price: 5 },
        { quantity: 3, price: 4 },
      ])
    ).toBe(22);
  });

  it('subtracts the discount', () => {
    expect(
      calculateOrderTotal([{ quantity: 1, price: 100 }], 30)
    ).toBe(70);
  });

  it('returns 0 (minus discount) for an empty cart', () => {
    expect(calculateOrderTotal([])).toBe(0);
    expect(calculateOrderTotal([], 10)).toBe(-10);
  });
});

describe('getStatusColor', () => {
  it('maps known statuses to their colour classes', () => {
    expect(getStatusColor('pending')).toBe('bg-yellow-100 text-yellow-800');
    expect(getStatusColor('ready')).toBe('bg-green-100 text-green-800');
    expect(getStatusColor('cancelled')).toBe('bg-red-100 text-red-800');
  });

  it('is case-insensitive', () => {
    expect(getStatusColor('PENDING')).toBe('bg-yellow-100 text-yellow-800');
    expect(getStatusColor('Preparing')).toBe('bg-blue-100 text-blue-800');
  });

  it('falls back to slate for unknown statuses', () => {
    expect(getStatusColor('nonsense')).toBe('bg-slate-100 text-slate-800');
  });
});

describe('truncate', () => {
  it('leaves short strings untouched (boundary inclusive)', () => {
    expect(truncate('hello', 5)).toBe('hello');
    expect(truncate('hi', 5)).toBe('hi');
  });

  it('slices and appends an ellipsis when too long', () => {
    expect(truncate('hello world', 5)).toBe('hello...');
  });
});

describe('getOrderUrgency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('classifies fresh orders (< 5 min)', () => {
    expect(getOrderUrgency(isoAgo(0))).toBe('fresh');
    expect(getOrderUrgency(isoAgo(4, 59))).toBe('fresh');
  });

  it('classifies attention orders (5–10 min)', () => {
    expect(getOrderUrgency(isoAgo(5))).toBe('attention');
    expect(getOrderUrgency(isoAgo(9, 59))).toBe('attention');
  });

  it('classifies urgent orders (10–15 min)', () => {
    expect(getOrderUrgency(isoAgo(10))).toBe('urgent');
    expect(getOrderUrgency(isoAgo(14, 59))).toBe('urgent');
  });

  it('classifies critical orders (> 15 min)', () => {
    expect(getOrderUrgency(isoAgo(15))).toBe('critical');
    expect(getOrderUrgency(isoAgo(120))).toBe('critical');
  });
});

describe('getUrgencyStyles', () => {
  it('returns a full style set per level', () => {
    expect(getUrgencyStyles('fresh').border).toBe('border-l-emerald-400');
    expect(getUrgencyStyles('attention').badge).toBe('bg-amber-100 text-amber-700');
    expect(getUrgencyStyles('urgent').text).toBe('text-orange-600');
    expect(getUrgencyStyles('critical').bg).toBe('bg-red-50');
  });

  it('always populates every style key', () => {
    for (const level of ['fresh', 'attention', 'urgent', 'critical'] as const) {
      const styles = getUrgencyStyles(level);
      expect(styles).toEqual(
        expect.objectContaining({
          border: expect.any(String),
          badge: expect.any(String),
          text: expect.any(String),
          bg: expect.any(String),
        })
      );
    }
  });
});

describe('sortOrdersByAge', () => {
  it('orders oldest-first without mutating the input', () => {
    const input = [
      { createdAt: isoAgo(1), id: 'newer' },
      { createdAt: isoAgo(10), id: 'oldest' },
      { createdAt: isoAgo(5), id: 'middle' },
    ];
    const snapshot = [...input];

    const sorted = sortOrdersByAge(input);

    expect(sorted.map((o) => o.id)).toEqual(['oldest', 'middle', 'newer']);
    // original array untouched
    expect(input).toEqual(snapshot);
  });
});

describe('getElapsedTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows minutes and seconds when over a minute', () => {
    expect(getElapsedTime(isoAgo(5, 23))).toBe('5m 23s');
  });

  it('shows only seconds when under a minute', () => {
    expect(getElapsedTime(isoAgo(0, 42))).toBe('42s');
  });
});

describe('calculateAverageWaitTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 for an empty list', () => {
    expect(calculateAverageWaitTime([])).toBe(0);
  });

  it('averages the per-order wait in milliseconds', () => {
    // waits of 2 min and 4 min -> average 3 min
    const avg = calculateAverageWaitTime([
      { createdAt: isoAgo(2) },
      { createdAt: isoAgo(4) },
    ]);
    expect(avg).toBe(3 * 60_000);
  });
});

describe('formatWaitTime', () => {
  it('pads seconds when minutes are present', () => {
    expect(formatWaitTime(5 * 60_000 + 3_000)).toBe('5m 03s');
  });

  it('omits minutes when under one minute', () => {
    expect(formatWaitTime(42_000)).toBe('42s');
  });

  it('floors sub-second remainders', () => {
    expect(formatWaitTime(59_999)).toBe('59s');
  });
});

describe('countUrgentOrders', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts only urgent + critical orders', () => {
    const orders = [
      { createdAt: isoAgo(1) }, // fresh
      { createdAt: isoAgo(7) }, // attention
      { createdAt: isoAgo(11) }, // urgent
      { createdAt: isoAgo(30) }, // critical
    ];
    expect(countUrgentOrders(orders)).toBe(2);
  });

  it('returns 0 when nothing is overdue', () => {
    expect(countUrgentOrders([{ createdAt: isoAgo(0) }])).toBe(0);
  });
});
