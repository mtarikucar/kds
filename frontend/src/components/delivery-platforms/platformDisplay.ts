/**
 * Single source of truth for delivery-platform branding (label + pill colours)
 * shared across the KDS card, the admin delivery-orders queue and the POS
 * pending list. Kept in its own module (not the component file) so consumers
 * can import the constants without tripping react-refresh's
 * "only-export-components" rule.
 */

export interface PlatformDisplay {
  label: string;
  /** Tailwind classes for the soft pill (light theme). */
  className: string;
  /** Tailwind classes for the high-contrast kiosk/dark theme. */
  kioskClassName: string;
}

export const PLATFORM_DISPLAY: Record<string, PlatformDisplay> = {
  YEMEKSEPETI: {
    label: 'Yemeksepeti',
    className: 'bg-pink-100 text-pink-700 ring-1 ring-pink-200',
    kioskClassName: 'bg-pink-500/20 text-pink-200 ring-1 ring-pink-500/40',
  },
  GETIR: {
    label: 'Getir',
    className: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200',
    kioskClassName: 'bg-purple-500/20 text-purple-200 ring-1 ring-purple-500/40',
  },
  TRENDYOL: {
    label: 'Trendyol',
    className: 'bg-orange-100 text-orange-700 ring-1 ring-orange-200',
    kioskClassName: 'bg-orange-500/20 text-orange-200 ring-1 ring-orange-500/40',
  },
  MIGROS: {
    label: 'Migros',
    className: 'bg-green-100 text-green-700 ring-1 ring-green-200',
    kioskClassName: 'bg-green-500/20 text-green-200 ring-1 ring-green-500/40',
  },
};

export function getPlatformDisplay(source: string): PlatformDisplay {
  return (
    PLATFORM_DISPLAY[source.toUpperCase()] ?? {
      label: source,
      className: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
      kioskClassName: 'bg-neutral-700 text-neutral-200 ring-1 ring-neutral-600',
    }
  );
}
