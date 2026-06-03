'use client';

import { useState } from 'react';
import SpecsTable from './SpecsTable';

/**
 * v2.8.87 — tabbed content panel for the product/service detail page.
 *
 * Hardware tabs: Açıklama | Özellikler | Uyumluluk | Gereklilikler | SSS
 * Service tabs:  Neler dahil | Süreç | Şartlar | SSS
 *
 * Client component because tab state lives in the URL hash for share-
 * ability (#tab=specs). Server-side render falls back to the default
 * tab on initial paint.
 */

interface Props {
  isService: boolean;
  description: string | null;
  specs: Record<string, unknown> | null;
  compat: Record<string, unknown> | null;
  details: {
    includes?: string[];
    requirements?: string[];
    faq?: { q: string; a: string }[];
    steps?: { title: string; body: string }[];
    videoUrl?: string;
  };
  warrantyMonths: number;
  t: {
    tabDescription: string;
    tabSpecs: string;
    tabCompat: string;
    tabRequirements: string;
    tabFaq: string;
    tabIncludes: string;
    tabSteps: string;
    warrantyMonthsLabel: string;
    noDetailsAuthored: string;
    empty: string;
  };
}

type TabKey =
  | 'description'
  | 'specs'
  | 'compat'
  | 'requirements'
  | 'faq'
  | 'includes'
  | 'steps';

export default function DetailTabs({
  isService,
  description,
  specs,
  compat,
  details,
  warrantyMonths,
  t,
}: Props) {
  const hardwareTabs: { key: TabKey; label: string }[] = [
    { key: 'description', label: t.tabDescription },
    { key: 'specs', label: t.tabSpecs },
    { key: 'compat', label: t.tabCompat },
    { key: 'requirements', label: t.tabRequirements },
    { key: 'faq', label: t.tabFaq },
  ];
  const serviceTabs: { key: TabKey; label: string }[] = [
    { key: 'includes', label: t.tabIncludes },
    { key: 'steps', label: t.tabSteps },
    { key: 'requirements', label: t.tabRequirements },
    { key: 'faq', label: t.tabFaq },
  ];
  const tabs = isService ? serviceTabs : hardwareTabs;
  const [active, setActive] = useState<TabKey>(tabs[0].key);

  return (
    <section className="mt-10">
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex flex-wrap gap-1" aria-label="Detay sekmeleri">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                active === tab.key
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="py-8">
        {active === 'description' && (
          <div className="prose prose-slate max-w-none text-slate-700">
            {description ? (
              <p className="whitespace-pre-line">{description}</p>
            ) : (
              <p className="text-sm text-slate-500">{t.noDetailsAuthored}</p>
            )}
            {warrantyMonths > 0 && (
              <p className="mt-4 text-sm text-slate-600">{t.warrantyMonthsLabel}</p>
            )}
          </div>
        )}

        {active === 'specs' && <SpecsTable specs={specs} />}

        {active === 'compat' && <CompatTable compat={compat} t={t} />}

        {active === 'includes' && (
          <BulletList items={details.includes} emptyMsg={t.noDetailsAuthored} />
        )}

        {active === 'steps' && <StepsList steps={details.steps} emptyMsg={t.noDetailsAuthored} />}

        {active === 'requirements' && (
          <BulletList items={details.requirements} emptyMsg={t.empty} />
        )}

        {active === 'faq' && <FaqList faq={details.faq} emptyMsg={t.empty} />}
      </div>
    </section>
  );
}

function BulletList({ items, emptyMsg }: { items?: string[]; emptyMsg: string }) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-slate-500">{emptyMsg}</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((s, i) => (
        <li key={i} className="flex items-start gap-3">
          <span aria-hidden className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          <span className="text-sm text-slate-700">{s}</span>
        </li>
      ))}
    </ul>
  );
}

function StepsList({
  steps,
  emptyMsg,
}: {
  steps?: { title: string; body: string }[];
  emptyMsg: string;
}) {
  if (!steps || steps.length === 0) {
    return <p className="text-sm text-slate-500">{emptyMsg}</p>;
  }
  return (
    <ol className="space-y-4">
      {steps.map((s, i) => (
        <li key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-900">{s.title}</div>
          <div className="mt-1 text-sm text-slate-600">{s.body}</div>
        </li>
      ))}
    </ol>
  );
}

function FaqList({
  faq,
  emptyMsg,
}: {
  faq?: { q: string; a: string }[];
  emptyMsg: string;
}) {
  if (!faq || faq.length === 0) {
    return <p className="text-sm text-slate-500">{emptyMsg}</p>;
  }
  return (
    <div className="space-y-4">
      {faq.map((item, i) => (
        <details key={i} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-900">
            {item.q}
          </summary>
          <p className="mt-2 text-sm text-slate-600">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

function CompatTable({
  compat,
  t,
}: {
  compat: Record<string, unknown> | null;
  t: Props['t'];
}) {
  if (!compat) return <p className="text-sm text-slate-500">{t.empty}</p>;
  // Drop UI-only fields (gibCertified is shown as a badge on the card,
  // sourceUrl is an external manufacturer link, not a compat fact).
  const entries = Object.entries(compat).filter(
    ([k]) => k !== 'gibCertified' && k !== 'sourceUrl',
  );
  if (entries.length === 0) return <p className="text-sm text-slate-500">{t.empty}</p>;
  return (
    <dl className="space-y-3">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded-lg border border-slate-200 p-4">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt>
          <dd className="mt-1 text-sm text-slate-900">
            {Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
