/**
 * v2.8.87 — service-specific hero for the detail page.
 *
 * Services don't have a meaningful gallery — they're labour, not boxes.
 * Replace the gallery with chip badges (serviceType, durationHours,
 * geoCoverage, requiresBranch) so the buyer immediately sees the
 * shape of the engagement.
 */

import { appHref } from '@/lib/urls';

interface ServiceMeta {
  durationHours?: number;
  geoCoverage?: string[];
  requiresBranch?: boolean;
  serviceType?: 'onsite' | 'remote' | 'consultation';
}

interface Props {
  name: string;
  brand: string | null;
  description: string | null;
  priceLabel: string;
  currency: string;
  serviceMeta: ServiceMeta | null;
  sku: string;
  t: {
    duration: string;
    coverage: string;
    remote: string;
    onsite: string;
    consultation: string;
    buy: string;
    requiresBranch: string;
  };
}

function serviceTypeLabel(type: string | undefined, t: Props['t']): string {
  switch (type) {
    case 'remote':
      return t.remote;
    case 'consultation':
      return t.consultation;
    case 'onsite':
    default:
      return t.onsite;
  }
}

export default function ServiceHero({
  name,
  brand,
  description,
  priceLabel,
  serviceMeta,
  sku,
  t,
}: Props) {
  const meta = serviceMeta ?? {};
  const serviceType = meta.serviceType ?? 'onsite';
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-50 to-white p-8">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {brand && (
            <span className="text-xs uppercase tracking-wide text-slate-500">{brand}</span>
          )}
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
            {serviceTypeLabel(serviceType, t)}
          </span>
          {meta.requiresBranch && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              {t.requiresBranch}
            </span>
          )}
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900">{name}</h1>
        {description && <p className="mt-3 text-slate-700">{description}</p>}

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {meta.durationHours ? (
            <div className="rounded-lg bg-white/70 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {t.duration}
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-900">
                {meta.durationHours} saat
              </div>
            </div>
          ) : null}
          {meta.geoCoverage && meta.geoCoverage.length > 0 ? (
            <div className="rounded-lg bg-white/70 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {t.coverage}
              </div>
              <div className="mt-1 text-sm text-slate-900">
                {meta.geoCoverage.join(', ')}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <div className="text-3xl font-semibold text-slate-900">{priceLabel}</div>
          <div className="mt-1 text-xs text-slate-500">Tek seferlik, KDV hariç</div>
          <a
            href={appHref(`/admin/store?sku=${encodeURIComponent(sku)}`)}
            className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            {t.buy}
          </a>
        </div>
      </div>
    </div>
  );
}
