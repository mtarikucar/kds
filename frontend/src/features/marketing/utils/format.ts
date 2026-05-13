import i18n from 'i18next';

/**
 * Format a date using the current i18n language rather than the
 * browser's OS-level default. Multiple marketing components used
 * `new Date(x).toLocaleDateString()` directly, which on a Turkish
 * admin's machine often resolved to `en-US` because the OS shipped
 * that as the default. Threading i18next.language keeps all marketing
 * UI dates consistent with the locale the rest of the page renders.
 */
function getLocale(): string {
  return i18n.language || 'tr';
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString(getLocale());
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleString(getLocale());
}
