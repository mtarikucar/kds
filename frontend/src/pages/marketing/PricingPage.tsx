import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import {
  formatCents,
  PricingProduct,
  useCatalogPricing,
} from '../../features/licensing/licensingApi';

/**
 * Public price list, rendered from the LIVE catalog.
 *
 * It used to render a hardcoded three-tier table in `marketing/data/plans.ts`.
 * That file was a second source of pricing truth: an operator changing a price
 * in the superadmin panel left the public site advertising an amount checkout
 * would not honour. Reading `/v1/catalog/pricing` — the same rows checkout
 * prices from — makes that impossible.
 */
const FREE_CORE_KEYS = [
  'pos',
  'kds',
  'menu',
  'tables',
  'qr',
  'orders',
  'cash',
  'reports',
  'team',
  'customers',
  'branding',
] as const;

const KIND_ORDER = ['license', 'module', 'integration', 'capacity', 'credit'] as const;

function ProductRow({ product }: { product: PricingProduct }) {
  const { t } = useTranslation('licensing');
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-gray-100 py-3 last:border-0 dark:border-gray-800">
      <div>
        <div className="font-medium text-gray-900 dark:text-gray-100">
          {product.name}
        </div>
        {product.description && (
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {product.description}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className="font-semibold text-gray-900 dark:text-gray-100">
          {formatCents(product.priceCents, product.currency)}
        </div>
        <div className="text-xs text-gray-500">
          {product.billing === 'annual'
            ? t('store.perYear')
            : t('store.oneTime')}
        </div>
      </div>
    </div>
  );
}

const PricingPage = () => {
  const { t } = useTranslation(['pricing', 'licensing', 'common']);
  const { data: products, isLoading } = useCatalogPricing();

  const grouped = useMemo(() => {
    const by = new Map<string, PricingProduct[]>();
    for (const p of products ?? []) {
      if (!by.has(p.kind)) by.set(p.kind, []);
      by.get(p.kind)!.push(p);
    }
    return by;
  }, [products]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <header className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {t('pricing:title')}
        </h1>
        <p className="mt-3 text-gray-600 dark:text-gray-400">
          {t('pricing:subtitle')}
        </p>
      </header>

      {/* The free core comes first and takes the most space. It is the offer:
          a restaurant can run its whole floor without paying anything, and
          leading with a price list would bury that. */}
      <section className="mt-10 rounded-2xl border-2 border-emerald-500 bg-emerald-50/50 p-6 dark:border-emerald-700 dark:bg-emerald-950/20">
        <h2 className="text-xl font-semibold text-emerald-900 dark:text-emerald-200">
          {t('pricing:freeCore.title')}
        </h2>
        <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
          {t('pricing:freeCore.subtitle')}
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {FREE_CORE_KEYS.map((key) => (
            <li
              key={key}
              className="flex items-center gap-2 text-sm text-emerald-900 dark:text-emerald-200"
            >
              <Check size={16} className="shrink-0" />
              {t(`pricing:freeCore.items.${key}`)}
            </li>
          ))}
        </ul>
      </section>

      {isLoading ? (
        <p className="mt-10 text-center text-sm text-gray-500">
          {t('common:loading')}
        </p>
      ) : (
        <div className="mt-10 space-y-8">
          {KIND_ORDER.filter((k) => grouped.has(k)).map((kind) => (
            <section
              key={kind}
              className="rounded-2xl border border-gray-200 p-6 dark:border-gray-800"
            >
              <h2 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t(`licensing:store.kind.${kind}`)}
              </h2>
              {kind === 'license' && (
                <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
                  {t('pricing:licenceNote')}
                </p>
              )}
              <div>
                {grouped.get(kind)!.map((p) => (
                  <ProductRow key={p.code} product={p} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <div className="mt-10 text-center">
        <Link
          to="/register"
          className="inline-flex rounded-xl bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
        >
          {t('pricing:cta')}
        </Link>
        <p className="mt-2 text-xs text-gray-500">{t('pricing:kdvNote')}</p>
      </div>
    </main>
  );
};

export default PricingPage;
