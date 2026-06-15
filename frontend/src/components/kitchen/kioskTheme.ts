/**
 * Class-set helpers for the KDS kiosk (dark, high-contrast) theme.
 *
 * Every component threads a `kiosk` boolean and asks these helpers for the
 * right class string. When `kiosk` is false the returned classes reproduce
 * the existing light look EXACTLY, so the default board is untouched.
 */

/** Page-level background + base text. */
export function kioskPage(kiosk: boolean): string {
  return kiosk
    ? 'bg-neutral-950 text-neutral-50 p-3 md:p-4 rounded-xl'
    : '';
}

/** Column shell background + border. */
export function kioskColumnShell(kiosk: boolean, lightBg: string): string {
  return kiosk
    ? 'rounded-xl border border-neutral-800 bg-neutral-900 h-full flex flex-col min-h-0'
    : `rounded-xl border border-slate-200/60 h-full flex flex-col min-h-0 ${lightBg}`;
}

/** Column header bar background. */
export function kioskColumnHeader(kiosk: boolean, lightHeaderBg: string): string {
  // In kiosk mode the saturated accent is kept (emerald/amber/red) but the
  // light pastel column bodies switch to near-black.
  return kiosk
    ? `flex items-center justify-between px-4 py-3 rounded-t-xl ${lightHeaderBg}`
    : `flex items-center justify-between px-4 py-3 rounded-t-xl ${lightHeaderBg}`;
}

/** Order card shell. */
export function kioskCardShell(kiosk: boolean): string {
  return kiosk
    ? 'bg-neutral-900 rounded-xl shadow-sm border-l-4 transition-all'
    : 'bg-white rounded-xl shadow-sm border-l-4 transition-all hover:shadow-md';
}

/** Primary order-number text. */
export function kioskTitleText(kiosk: boolean): string {
  return kiosk
    ? 'text-2xl md:text-3xl font-bold text-white'
    : 'text-xl md:text-2xl font-bold text-slate-900';
}

/** Item name text. */
export function kioskItemNameText(kiosk: boolean): string {
  return kiosk ? 'font-semibold text-white truncate text-base' : 'font-medium text-slate-900 truncate';
}

/** Item quantity text. */
export function kioskQtyText(kiosk: boolean): string {
  return kiosk
    ? 'font-bold text-white ml-2 tabular-nums text-base'
    : 'font-bold text-slate-900 ml-2 tabular-nums';
}

/** Stats header heading color. */
export function kioskHeadingText(kiosk: boolean): string {
  return kiosk
    ? 'text-2xl md:text-3xl font-heading font-bold text-white'
    : 'text-2xl md:text-3xl font-heading font-bold text-slate-900';
}
