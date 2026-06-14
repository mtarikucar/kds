/**
 * Pure presentation helpers extracted verbatim from HealthPage so the
 * pill colour mapping and age formatting are unit-testable in isolation.
 */

export function pillClass(pill: 'green' | 'yellow' | 'red'): string {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';
  if (pill === 'green') return `${base} bg-green-100 text-green-800`;
  if (pill === 'yellow') return `${base} bg-amber-100 text-amber-800`;
  return `${base} bg-red-100 text-red-800`;
}

export function formatAge(min: number | null): string {
  if (min == null) return '—';
  if (min < 1) return '<1m';
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 24 * 60) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / (24 * 60))}d`;
}
