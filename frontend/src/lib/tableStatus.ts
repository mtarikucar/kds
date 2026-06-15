import { CheckCircle, XCircle, Clock, type LucideIcon } from 'lucide-react';
import type { TFunction } from 'i18next';
import { TableStatus } from '../types';

/**
 * Single source of truth for table-status visuals across the whole app:
 *   - admin Table Management page
 *   - POS floor grid
 *   - customer QR table picker
 *
 * Standardized palette (was inconsistent green/yellow/slate before):
 *   AVAILABLE → emerald, OCCUPIED → red, RESERVED → amber.
 *
 * Each entry carries every class flavour the three surfaces need so no
 * screen has to re-derive colours: a Badge `variant`, gradient/solid
 * fills for the admin cards, a soft `chip` (bg+text+border) for the
 * customer picker, and the lucide `icon`. The `labelKey` is the
 * preferred i18n key but callers may pass their own label since the
 * three screens live in different namespaces.
 */
export interface TableStatusConfigEntry {
  /** Badge variant token (maps to ui/Badge variants). */
  variant: 'success' | 'danger' | 'warning' | 'default';
  /** lucide icon for the status. */
  icon: LucideIcon;
  /** Tailwind colour family root, e.g. 'emerald' — for ad-hoc usage. */
  accent: 'emerald' | 'red' | 'amber';
  /** Solid gradient fill (admin card table tile). */
  gradient: string;
  /** Soft tinted background (admin status badge). */
  lightBg: string;
  /** Top status bar gradient (admin card). */
  barGradient: string;
  /** Soft chip: bg + text + border, for the customer picker tiles. */
  chip: string;
  /** Preferred i18n key (common namespace) for the label. */
  labelKey: string;
}

/** Accept any i18next TFunction (regardless of bound namespace) plus the
 *  simple (key, default) shape used in unit tests. */
type TFn = TFunction<string | readonly string[]> | ((key: string, defaultValue?: string) => string);

export const tableStatusConfig: Record<TableStatus, TableStatusConfigEntry> = {
  [TableStatus.AVAILABLE]: {
    variant: 'success',
    icon: CheckCircle,
    accent: 'emerald',
    gradient: 'bg-gradient-to-br from-emerald-500 to-emerald-600',
    lightBg: 'bg-emerald-50 text-emerald-700',
    barGradient: 'bg-gradient-to-r from-emerald-400 to-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-300',
    labelKey: 'admin.available',
  },
  [TableStatus.OCCUPIED]: {
    variant: 'danger',
    icon: XCircle,
    accent: 'red',
    gradient: 'bg-gradient-to-br from-red-500 to-red-600',
    lightBg: 'bg-red-50 text-red-700',
    barGradient: 'bg-gradient-to-r from-red-400 to-red-500',
    chip: 'bg-red-50 text-red-700 border-red-300',
    labelKey: 'admin.occupied',
  },
  [TableStatus.RESERVED]: {
    variant: 'warning',
    icon: Clock,
    accent: 'amber',
    gradient: 'bg-gradient-to-br from-amber-500 to-amber-600',
    lightBg: 'bg-amber-50 text-amber-700',
    barGradient: 'bg-gradient-to-r from-amber-400 to-amber-500',
    chip: 'bg-amber-50 text-amber-700 border-amber-300',
    labelKey: 'admin.reserved',
  },
};

/** Turkish-first fallbacks so the label never renders a raw key even if
 *  a namespace is missing the entry (e.g. customer picker lacked
 *  `reserved` before). */
const FALLBACK_LABELS: Record<TableStatus, string> = {
  [TableStatus.AVAILABLE]: 'Müsait',
  [TableStatus.OCCUPIED]: 'Dolu',
  [TableStatus.RESERVED]: 'Rezerve',
};

/**
 * Resolve a status to its config, tolerating unknown/legacy string
 * values by falling back to AVAILABLE so a surface never crashes on a
 * stray status from the API.
 */
export function getTableStatusConfig(
  status: TableStatus | string,
): TableStatusConfigEntry {
  return (
    tableStatusConfig[status as TableStatus] ??
    tableStatusConfig[TableStatus.AVAILABLE]
  );
}

/**
 * Translate a status label using the supplied `t`. Pass `keyOverride`
 * when the calling screen stores the label under a different key/namespace
 * (e.g. the POS grid uses `tableGrid.status.<STATUS>`). Always supplies a
 * Turkish default so a missing key never leaks a raw i18n path.
 */
export function getTableStatusLabel(
  status: TableStatus | string,
  t: TFn,
  keyOverride?: string,
): string {
  const config = getTableStatusConfig(status);
  const fallback = FALLBACK_LABELS[status as TableStatus] ?? String(status);
  return t(keyOverride ?? config.labelKey, fallback);
}
