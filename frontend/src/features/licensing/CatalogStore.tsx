import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ShoppingCart } from 'lucide-react';
import { useEntitlements } from '../../contexts/SubscriptionContext';
import {
  formatCents,
  PricingProduct,
  useCatalogPricing,
} from './licensingApi';
import { usePurchaseAddOnViaCheckout } from '../marketplace/marketplaceApi';
import Button from '../../components/ui/Button';

/** Display order of the catalog sections. */
const KIND_ORDER = [
  'license',
  'module',
  'integration',
  'capacity',
  'credit',
  'service',
] as const;

/**
 * The à-la-carte storefront.
 *
 * Every card shows two numbers: the annual list price and what the product
 * costs THIS tenant today, day-prorated to their anniversary. Showing only the
 * list price would overstate a mid-year purchase by up to twelve times, and
 * showing only the prorated one would hide what they will pay at renewal.
 *
 * Both figures come from the licensing snapshot — the same catalog read the
 * checkout prices from — so what the card says is what the card charges.
 */
const CatalogStore = ({ focusCode }: { focusCode?: string }) => {
  const { t } = useTranslation(['licensing', 'common']);
  const { data: products, isLoading } = useCatalogPricing();
  const { offerFor, owned, license, snapshot } = useEntitlements();
  const purchase = usePurchaseAddOnViaCheckout();
  const [busy, setBusy] = useState<string | null>(null);

  const ownedCodes = useMemo(
    () => new Set(owned.filter((o) => o.status === 'active').map((o) => o.code)),
    [owned],
  );

  // Offers are keyed by GRANT key, not by product code, so index them by code
  // once rather than guessing which key a product happens to grant.
  const offerByCode = useMemo(() => {
    const map = new Map<string, ReturnType<typeof offerFor>>();
    for (const p of products ?? []) {
      const found = (snapshot?.offers ? Object.values(snapshot.offers) : []).find(
        (o) => o.code === p.code,
      );
      if (found) map.set(p.code, found);
    }
    return map;
  }, [products, snapshot]);

  const grouped = useMemo(() => {
    const by = new Map<string, PricingProduct[]>();
    for (const p of products ?? []) {
      if (!by.has(p.kind)) by.set(p.kind, []);
      by.get(p.kind)!.push(p);
    }
    return by;
  }, [products]);

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">{t('common:loading')}</div>;
  }

  const needsLicence =
    license.status === 'none' || license.status === 'expired';

  const buy = async (product: PricingProduct) => {
    setBusy(product.code);
    try {
      // The licence rides along automatically when the tenant does not have
      // one: the server rejects a licence-gated line without it, and making
      // the customer discover that by failing at checkout would be hostile.
      const items =
        product.requiresLicense && needsLicence
          ? [
              { type: 'addon' as const, code: 'license_annual', qty: 1 },
              { type: 'addon' as const, code: product.code, qty: 1 },
            ]
          : [{ type: 'addon' as const, code: product.code, qty: 1 }];
      await purchase.mutateAsync({ items });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      {KIND_ORDER.filter((k) => grouped.has(k)).map((kind) => (
        <section key={kind}>
          <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t(`licensing:store.kind.${kind}`)}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {grouped.get(kind)!.map((product) => {
              const isOwned = ownedCodes.has(product.code);
              // Credits and services grant nothing gate-able, so they have no
              // offer entry — their list price IS the price.
              const offer = offerByCode.get(product.code) ?? null;
              const prorated = offer?.proratedCents ?? product.priceCents;
              const isAnnual = product.billing === 'annual';
              const showProrated = isAnnual && prorated !== product.priceCents;

              return (
                <article
                  key={product.code}
                  id={`product-${product.code}`}
                  className={`flex flex-col rounded-xl border p-4 transition ${
                    focusCode === product.code
                      ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900'
                      : 'border-gray-200 dark:border-gray-800'
                  } bg-white dark:bg-gray-900`}
                >
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">
                    {product.name}
                  </h3>
                  {product.description && (
                    <p className="mt-1 flex-1 text-sm text-gray-600 dark:text-gray-400">
                      {product.description}
                    </p>
                  )}

                  <div className="mt-3">
                    <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {formatCents(product.priceCents, product.currency)}
                      <span className="ml-1 text-xs font-normal text-gray-500">
                        {isAnnual
                          ? t('licensing:store.perYear')
                          : t('licensing:store.oneTime')}
                      </span>
                    </div>
                    {showProrated && (
                      <div className="text-sm text-emerald-700 dark:text-emerald-400">
                        {t('licensing:store.todayPrice', {
                          prorated: formatCents(prorated, product.currency),
                        })}
                      </div>
                    )}
                    {offer?.periodEnd && (
                      <div className="text-xs text-gray-500">
                        {t('licensing:store.untilDate', {
                          date: new Date(offer.periodEnd).toLocaleDateString('tr-TR'),
                        })}
                      </div>
                    )}
                  </div>

                  {product.requiresLicense && needsLicence && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      {t('licensing:store.licenceFirst')}
                    </p>
                  )}

                  <div className="mt-4">
                    {isOwned && product.kind !== 'credit' && product.kind !== 'capacity' ? (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                        <Check size={16} />
                        {t('licensing:store.owned')}
                      </span>
                    ) : (
                      <Button
                        onClick={() => buy(product)}
                        disabled={busy === product.code}
                        className="w-full"
                      >
                        <ShoppingCart size={16} className="mr-1" />
                        {t('licensing:store.buy')}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
      {grouped.size === 0 && (
        <p className="text-sm text-gray-500">{t('licensing:store.empty')}</p>
      )}
    </div>
  );
};

export default CatalogStore;
