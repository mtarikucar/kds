/**
 * Yalnızca http(s) şemasını geçir. `javascript:` yükü ve protokol-göreli
 * `//host` açık yönlendirmesi elenir. Sunucu da aynı süzgeci uyguluyor;
 * bu ikinci kemer.
 */
export function safePartnerUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : null;
}
