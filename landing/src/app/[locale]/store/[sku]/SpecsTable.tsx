/**
 * v2.8.87 — server-rendered spec sheet for the product detail page.
 *
 * Takes the free-form `specs` JSON and renders it as a two-column
 * key/value table. The convention is:
 *   - `headlineSpecs: string[]` — short bullet chips shown on the card
 *     (not rendered here; the card pulls these out).
 *   - everything else — display(s) / dimensions / connectivity / etc.
 *
 * Falls back to "no specs authored" friendly empty state when the JSON
 * has only headlineSpecs (or is otherwise empty after stripping).
 */

interface Props {
  specs: Record<string, unknown> | null;
}

// Pretty-print known keys to Turkish labels. Unknown keys fall back to
// the raw key (snake_case → spaces) so a new key surfaces immediately
// without code changes; we only override the common ones.
const LABEL_TR: Record<string, string> = {
  display: 'Ekran',
  connectivity: 'Bağlantı',
  printer: 'Yazıcı',
  battery: 'Pil',
  weight: 'Ağırlık',
  os: 'İşletim sistemi',
  width: 'Genişlik',
  interface: 'Arayüz',
  speed: 'Hız',
  autoCutter: 'Otomatik kesici',
  protocol: 'Protokol',
  mount: 'Montaj',
  security: 'Güvenlik',
};

function labelFor(key: string): string {
  if (LABEL_TR[key]) return LABEL_TR[key];
  // Convert "snake_case" / "camelCase" to "Spaced Words".
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

function valueFor(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır';
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default function SpecsTable({ specs }: Props) {
  if (!specs) {
    return (
      <p className="text-sm text-slate-500">Bu ürün için detaylı özellik bilgisi henüz girilmedi.</p>
    );
  }
  // Drop headlineSpecs — that's card-only metadata.
  const entries = Object.entries(specs).filter(([k]) => k !== 'headlineSpecs');
  if (entries.length === 0) {
    return (
      <p className="text-sm text-slate-500">Bu ürün için detaylı özellik bilgisi henüz girilmedi.</p>
    );
  }
  return (
    <dl className="divide-y divide-slate-200 rounded-lg border border-slate-200">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[200px_1fr] sm:gap-4">
          <dt className="text-sm font-medium text-slate-500">{labelFor(k)}</dt>
          <dd className="text-sm text-slate-900">{valueFor(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
