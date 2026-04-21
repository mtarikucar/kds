/**
 * Timezone helpers for tenant-local day boundaries. The restaurant's
 * "day" starts at midnight in the tenant's configured timezone, not in
 * the server's — without this correction a Z-Report or scheduler can
 * miss the last hour of Istanbul orders if the backend pod runs in UTC.
 *
 * Uses `Intl.DateTimeFormat` (zero-dep) and falls back to server-local
 * midnight if the tz string is unknown so one bad tenant config can't
 * break the feature for everyone else.
 */

/** Midnight `now` falls into, expressed as a UTC Date, for `timezone`. */
export function getTenantMidnight(now: Date, timezone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const y = parseInt(parts.find((p) => p.type === 'year')?.value ?? '1970', 10);
    const m = parseInt(parts.find((p) => p.type === 'month')?.value ?? '1', 10);
    const d = parseInt(parts.find((p) => p.type === 'day')?.value ?? '1', 10);
    const approx = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    const probe = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(approx);
    const get = (t: string) => parseInt(probe.find((p) => p.type === t)?.value ?? '0', 10);
    const zonedAsUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    );
    const offset = zonedAsUtc - approx.getTime();
    return new Date(approx.getTime() - offset);
  } catch {
    const fallback = new Date(now);
    fallback.setHours(0, 0, 0, 0);
    return fallback;
  }
}

/**
 * `[startOfDay, endOfDay]` boundaries for the calendar date `dateStr`
 * (`YYYY-MM-DD`) interpreted in `timezone`. Useful for
 * `where: { paidAt: { gte: start, lt: nextStart } }` style queries.
 */
export function getTenantDayBounds(
  dateStr: string,
  timezone: string,
): { start: Date; end: Date } {
  // Anchor at noon so DST jumps (which happen at night) don't push us
  // into the wrong day during offset calculation.
  const anchor = new Date(`${dateStr}T12:00:00Z`);
  const start = getTenantMidnight(anchor, timezone);
  const nextDay = new Date(anchor.getTime() + 24 * 60 * 60 * 1000);
  const end = getTenantMidnight(nextDay, timezone);
  return { start, end };
}
