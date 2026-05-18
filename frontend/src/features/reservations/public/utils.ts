/**
 * Format helpers shared by the public reservation wizard and the
 * lookup page. Centralized to avoid the `new Date(dateStr + 'T00:00:00')`
 * footgun that caused "Invalid Date" to render on the success card and
 * the lookup result: the backend serializes `Reservation.date` (Prisma
 * `@db.Date`) as a full ISO datetime, so appending another time portion
 * yields a malformed string that `Date` rejects.
 */

/**
 * Parse a reservation date string into a localized human-readable date.
 *
 * Tolerates the three shapes the codebase can hand us:
 *   - `"2026-03-01"` (date-only — e.g. the form's `<input type="date">`)
 *   - `"2026-03-01T00:00:00.000Z"` (Prisma's serialized `@db.Date`)
 *   - `"2026-03-01T19:00:00+03:00"` (a tz-offset ISO from anywhere)
 *
 * Returns the input string unchanged when parsing fails, so a
 * regression never paints the literal "Invalid Date" on screen.
 */
export function formatReservationDate(input: string | null | undefined): string {
  if (!input) return '';
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return input;
  }
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Convert a 24h "HH:mm" time string to a 12h "h:mm AM/PM" label. Used
 * for review/summary rows and the time-slot pills. Returns the input
 * unchanged on malformed entries so we never silently render
 * "NaN:undefined PM".
 */
export function formatTime(time: string | null | undefined): string {
  if (!time) return '';
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const h = parseInt(match[1], 10);
  const minutes = match[2];
  if (!Number.isFinite(h) || h < 0 || h > 23) return time;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${minutes} ${ampm}`;
}

/**
 * Convenience for the review/summary "Time" row: renders
 * "2:30 PM — 4:00 PM" from two HH:mm strings. Falls back to a single
 * formatted start time when end is missing.
 */
export function formatTimeRange(start: string, end?: string | null): string {
  const startLabel = formatTime(start);
  const endLabel = end ? formatTime(end) : '';
  return endLabel ? `${startLabel} — ${endLabel}` : startLabel;
}
