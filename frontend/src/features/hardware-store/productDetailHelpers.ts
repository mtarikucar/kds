/**
 * Pure presentation helpers extracted verbatim from ProductDetailPage
 * (v2.8.87) so the spec/compat/details formatting is unit-testable.
 *
 * `localizeDetails` previously read `document.documentElement.lang`
 * internally; it now takes the current language as an explicit `lang`
 * parameter so it is a pure function. The call site passes the same
 * value it used to read.
 */

export function prettyKey(k: string): string {
  return k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function prettyValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function localizeDetails(
  raw: unknown,
  lang: string,
): {
  includes?: string[];
  requirements?: string[];
  steps?: { title: string; body: string }[];
  faq?: { q: string; a: string }[];
} {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  // Locale-keyed: { tr: {...}, en: {...} }. Pick the current i18n
  // language with TR fallback, then fall through to flat.
  if (obj.tr || obj.en) {
    return (obj[lang] as any) ?? (obj.tr as any) ?? (obj.en as any) ?? {};
  }
  return obj as any;
}
