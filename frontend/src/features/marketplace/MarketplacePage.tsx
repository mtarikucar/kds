import { useState } from 'react';
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
 * a clear message that we surface in a toast.
 */
export default function MarketplacePage() {
  const { t } = useTranslation('common');
  const [kind, setKind] = useState<string | undefined>(undefined);
  const { data: catalog = [], isLoading: catalogLoading } = useListAddOns(kind);
  const { data: mine = [] } = useListMyAddOns();
  const purchase = usePurchaseAddOn();
  const cancel = useCancelAddOn();

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
          {catalog.map((a: MarketplaceAddOn) => (
            <article key={a.code} className="rounded-lg border bg-white p-4">
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
                  onClick={() => purchase.mutate({ addOnCode: a.code })}
                >
                  {t('hummytummy.marketplace.purchase')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('hummytummy.marketplace.mine')}</h2>
        {mine.length === 0 ? (
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
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => cancel.mutate({ id: row.id })}
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
