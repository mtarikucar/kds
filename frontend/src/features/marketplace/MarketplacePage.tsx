import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCancelAddOn,
  useListAddOns,
  useListMyAddOns,
  usePurchaseAddOn,
  type MarketplaceAddOn,
} from './marketplaceApi';

const KIND_CODES = [undefined, 'software', 'integration', 'capacity', 'support'] as const;

/**
 * Tenant marketplace. Two stacked sections:
 *   1. Catalogue cards filtered by kind.
 *   2. "Your add-ons" table showing what's active.
 *
 * Purchase happens with one click — the backend gates deps and rejects with
 * a clear message that we surface in a toast. On success the purchase hook
 * invalidates entitlements + effective-features so the unlocked feature
 * reflects in the UI within a tick (no hard refresh).
 *
 * Deep-link: UpsellCard links here with ?focus=<code>. We scroll that card
 * into view and flash a highlight ring so the buyer lands on the right add-on.
 */
export default function MarketplacePage() {
  const { t } = useTranslation('common');
  // Read ?focus=<code> straight off the URL rather than useSearchParams so the
  // component doesn't require a Router context (it's always mounted inside the
  // admin router in the app; the deep link comes from UpsellCard).
  const focusCode = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    return new URLSearchParams(window.location.search).get('focus') ?? undefined;
  }, []);
  const [kind, setKind] = useState<string | undefined>(undefined);
  const { data: catalog = [], isLoading: catalogLoading } = useListAddOns(kind);
  const { data: mine = [], isLoading: mineLoading } = useListMyAddOns();
  const purchase = usePurchaseAddOn();
  const cancel = useCancelAddOn();

  // Track the in-flight purchase by code so the busy label only shows on the
  // clicked card (purchase.isPending is global to the mutation).
  const [purchasingCode, setPurchasingCode] = useState<string | null>(null);

  // Deep-link focus: scroll the matching card into view + flash a highlight.
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const [highlightCode, setHighlightCode] = useState<string | null>(null);
  const catalogCodes = useMemo(
    () => catalog.map((a: MarketplaceAddOn) => a.code).join(','),
    [catalog],
  );
  useEffect(() => {
    if (!focusCode || catalogLoading) return;
    const el = cardRefs.current[focusCode];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightCode(focusCode);
    const tid = setTimeout(() => setHighlightCode(null), 2500);
    return () => clearTimeout(tid);
    // Re-run once the catalogue (which holds the target card) has loaded.
  }, [focusCode, catalogLoading, catalogCodes]);

  // Clear the per-card busy marker once the mutation settles. Driven off
  // isPending so handlePurchase can call mutate() with a single positional
  // arg (the catalogue test asserts the exact mutate payload).
  useEffect(() => {
    if (!purchase.isPending) setPurchasingCode(null);
  }, [purchase.isPending]);

  const handlePurchase = (code: string) => {
    setPurchasingCode(code);
    purchase.mutate({ addOnCode: code });
  };

  const handleCancel = (id: string, name: string) => {
    const message = t('hummytummy.marketplace.cancelConfirm', {
      defaultValue: `"${name}" eklentisini iptal etmek istediğinize emin misiniz?`,
      name,
    });
    // Native confirm. jsdom (tests) returns undefined → we only abort on an
    // explicit `false` (the user pressed Cancel in a real browser dialog).
    if (window.confirm(message) === false) return;
    cancel.mutate({ id });
  };

  return (
    <div className="space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('hummytummy.marketplace.title')}</h1>
        <p className="text-sm text-gray-600">{t('hummytummy.marketplace.subtitle')}</p>
      </header>

      <div className="flex gap-2">
        {KIND_CODES.map((k) => (
          <button
            key={k ?? 'all'}
            className={`rounded-full px-3 py-1 text-sm ${
              kind === k ? 'bg-gray-900 text-white' : 'border bg-white hover:bg-gray-50'
            }`}
            onClick={() => setKind(k)}
          >
            {t(`hummytummy.marketplace.filter.${k ?? 'all'}`)}
          </button>
        ))}
      </div>

      {catalogLoading ? (
        <div className="text-sm text-gray-500">{t('hummytummy.common.loading')}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {catalog.map((a: MarketplaceAddOn) => {
            const isBusy = purchase.isPending && purchasingCode === a.code;
            const isHighlighted = highlightCode === a.code;
            return (
              <article
                key={a.code}
                ref={(el) => {
                  cardRefs.current[a.code] = el;
                }}
                className={`rounded-lg border bg-white p-4 transition-shadow ${
                  isHighlighted
                    ? 'ring-2 ring-blue-500 ring-offset-2 shadow-lg'
                    : ''
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="font-semibold">{a.name}</h3>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{a.kind}</span>
                </div>
                <p className="mb-3 text-sm text-gray-600">{a.description}</p>
                {a.deps.length > 0 && (
                  <p className="mb-2 text-xs text-amber-700">
                    {t('hummytummy.marketplace.requires')} {a.deps.join(', ')}
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-lg font-medium">
                    {(a.priceCents / 100).toLocaleString('tr-TR', { style: 'currency', currency: a.currency })}
                    {a.billing === 'recurring' && <span className="text-xs text-gray-500"> / mo</span>}
                  </span>
                  <button
                    className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                    disabled={purchase.isPending}
                    onClick={() => handlePurchase(a.code)}
                  >
                    {isBusy
                      ? t('hummytummy.marketplace.purchasing')
                      : t('hummytummy.marketplace.purchase')}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('hummytummy.marketplace.mine')}</h2>
        {mineLoading ? (
          <p className="text-sm text-gray-500">{t('hummytummy.common.loading')}</p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-gray-500">{t('hummytummy.marketplace.mineEmpty')}</p>
        ) : (
          <table className="w-full divide-y rounded border text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t('hummytummy.marketplace.col.addOn')}</th>
                <th className="px-3 py-2 font-medium">{t('hummytummy.marketplace.col.quantity')}</th>
                <th className="px-3 py-2 font-medium">{t('hummytummy.marketplace.col.status')}</th>
                <th className="px-3 py-2 font-medium">{t('hummytummy.marketplace.col.periodEnds')}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {mine.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.addOn.name}</div>
                    <div className="text-xs text-gray-500">{row.addOn.code}</div>
                  </td>
                  <td className="px-3 py-2">{row.quantity}</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">{row.status}</span>
                    {row.cancelAtPeriodEnd && (
                      <span className="ml-2 text-xs text-amber-600">
                        {t('hummytummy.marketplace.cancelAtPeriodEnd')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {row.currentPeriodEnd ? new Date(row.currentPeriodEnd).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {row.status === 'active' && (
                      <button
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                        disabled={cancel.isPending}
                        onClick={() => handleCancel(row.id, row.addOn.name)}
                      >
                        {t('hummytummy.common.cancel')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
