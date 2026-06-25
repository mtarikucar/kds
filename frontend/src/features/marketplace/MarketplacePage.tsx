import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Store,
  Package,
  Puzzle,
  Boxes,
  LifeBuoy,
  LayoutGrid,
  ShoppingCart,
  CheckCircle2,
  AlertTriangle,
  Inbox,
  Link2,
} from 'lucide-react';
import {
  useCancelAddOn,
  useListAddOns,
  useListMyAddOns,
  usePurchaseAddOnViaCheckout,
  type MarketplaceAddOn,
} from './marketplaceApi';
import Card from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';

const KIND_CODES = [undefined, 'software', 'integration', 'capacity', 'support'] as const;

const KIND_ICON: Record<string, typeof Package> = {
  all: LayoutGrid,
  software: Package,
  integration: Puzzle,
  capacity: Boxes,
  support: LifeBuoy,
};

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'default'> = {
  active: 'success',
  expired: 'warning',
  cancelled: 'default',
};

/**
 * Tenant marketplace. Catalogue cards (filtered by kind) + a "Your add-ons"
 * table. Purchase is one click; the backend gates deps and rejects with a
 * clear message we surface in a toast, then invalidates entitlements +
 * effective-features so the unlocked feature reflects within a tick.
 *
 * Deep-link: UpsellCard links here with ?focus=<code>. We scroll that card
 * into view and flash a highlight ring so the buyer lands on the right add-on.
 */
export default function MarketplacePage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation('common');
  const [searchParams, setSearchParams] = useSearchParams();
  const focusCode = searchParams.get('focus') ?? undefined;
  // Pre-select the category from `?kind=` (e.g. the onboarding checklist deep-
  // links `?tab=addons&kind=integration`) so the linked add-on group is shown.
  const [kind, setKind] = useState<string | undefined>(
    () => searchParams.get('kind') ?? undefined,
  );
  const { data: catalog = [], isLoading: catalogLoading } = useListAddOns(kind);
  const { data: mine = [], isLoading: mineLoading } = useListMyAddOns();
  const purchase = usePurchaseAddOnViaCheckout();
  const cancel = useCancelAddOn();

  const [purchasingCode, setPurchasingCode] = useState<string | null>(null);

  // Codes the tenant already owns (active) — drives the "owned" card state.
  const ownedCodes = useMemo(
    () =>
      new Set(
        mine.filter((m) => m.status === 'active').map((m) => m.addOn.code),
      ),
    [mine],
  );

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
    // Only the focused card present in the CURRENT (kind-filtered) catalogue
    // can be scrolled to + highlighted. If it isn't here we still fall through
    // to clear `?focus=` below — otherwise the param sticks forever (a stale
    // deep-link that re-fires the no-op on every reload / tab-switch).
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightCode(focusCode);
    }
    // Always clear `?focus=` once the catalogue has loaded so the hub URL stays
    // clean (keeps tab + kind) regardless of whether the card was found.
    const tid = setTimeout(() => {
      setHighlightCode(null);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('focus');
          return next;
        },
        { replace: true },
      );
    }, 2500);
    return () => clearTimeout(tid);
  }, [focusCode, catalogLoading, catalogCodes, setSearchParams]);

  useEffect(() => {
    if (!purchase.isPending) setPurchasingCode(null);
  }, [purchase.isPending]);

  const handlePurchase = (code: string) => {
    // Paid flow: confirm the price, then hand off to PayTR's hosted page. The
    // add-on is granted by the webhook only after the payment settles — no
    // more free comps from the storefront button.
    const addon = catalog.find((a: MarketplaceAddOn) => a.code === code);
    // Defence in depth: never start a checkout for something the tenant already
    // has — whether it's included in their plan OR already purchased. `owned`
    // comes from a separate query (/addons/mine) that may still be loading when
    // the catalogue renders, so this guard backs up the hidden/disabled button
    // and prevents a double-charge in that window.
    if (addon?.includedInPlan || ownedCodes.has(code)) return;
    const price = addon
      ? (addon.priceCents / 100).toLocaleString('tr-TR', {
          style: 'currency',
          currency: addon.currency || 'TRY',
        })
      : '';
    const suffix = addon?.billing === 'recurring' ? '/ay' : '';
    const message = t('hummytummy.marketplace.purchaseConfirm', {
      defaultValue: `Bu eklenti ${price}${suffix}. Ödemeyi tamamlamak için güvenli ödeme sayfasına yönlendirileceksiniz. Devam edilsin mi?`,
      price,
      suffix,
    });
    if (window.confirm(message) === false) return;
    setPurchasingCode(code);
    purchase.mutate({ addOnCode: code });
  };

  const handleCancel = (id: string, name: string) => {
    const message = t('hummytummy.marketplace.cancelConfirm', {
      defaultValue: `"${name}" eklentisini iptal etmek istediğinize emin misiniz?`,
      name,
    });
    if (window.confirm(message) === false) return;
    cancel.mutate({ id });
  };

  return (
    <div className={embedded ? 'space-y-6' : 'mx-auto max-w-6xl space-y-6 p-4 sm:p-6'}>
      {/* Header — suppressed when embedded in the Mağaza hub (it owns the title) */}
      {!embedded && (
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
            <Store className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {t('hummytummy.marketplace.title')}
            </h1>
            <p className="text-sm text-slate-500">
              {t('hummytummy.marketplace.subtitle')}
            </p>
          </div>
        </div>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {KIND_CODES.map((k) => {
          const key = k ?? 'all';
          const Icon = KIND_ICON[key] ?? LayoutGrid;
          const active = kind === k;
          return (
            <button
              key={key}
              type="button"
              className={
                'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ' +
                (active
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')
              }
              onClick={() => setKind(k)}
            >
              <Icon className="h-4 w-4" />
              <span>{t(`hummytummy.marketplace.filter.${key}`)}</span>
            </button>
          );
        })}
      </div>

      {/* Catalogue */}
      {catalogLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="col-span-full text-sm text-slate-500">
            {t('hummytummy.common.loading')}
          </div>
          {[0, 1, 2].map((i) => (
            <Card key={i} variant="bordered" className="h-40 animate-pulse p-4">
              <div className="h-4 w-1/2 rounded bg-slate-100" />
              <div className="mt-3 h-3 w-full rounded bg-slate-100" />
              <div className="mt-2 h-3 w-2/3 rounded bg-slate-100" />
            </Card>
          ))}
        </div>
      ) : catalog.length === 0 ? (
        <Card variant="bordered" className="flex flex-col items-center gap-2 p-10 text-center">
          <Inbox className="h-8 w-8 text-slate-300" />
          <p className="text-sm text-slate-500">
            {t('hummytummy.marketplace.catalogEmpty', {
              defaultValue: 'Bu kategoride şu an eklenti yok.',
            })}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {catalog.map((a: MarketplaceAddOn) => {
            const isBusy = purchase.isPending && purchasingCode === a.code;
            const isHighlighted = highlightCode === a.code;
            const owned = ownedCodes.has(a.code);
            // Already provided by the tenant's plan (server-computed). Shown as
            // "included", never sold — purchased add-ons (owned) take priority.
            const includedInPlan = !owned && !!a.includedInPlan;
            const KindIcon = KIND_ICON[a.kind] ?? Package;
            return (
              <article
                key={a.code}
                ref={(el) => {
                  cardRefs.current[a.code] = el;
                }}
                className={
                  'flex flex-col rounded-xl border bg-white p-5 transition-all ' +
                  (isHighlighted
                    ? 'border-primary-400 ring-2 ring-primary-400 ring-offset-2 shadow-lg'
                    : 'border-slate-200 hover:shadow-md')
                }
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                      <KindIcon className="h-5 w-5" />
                    </div>
                    <h3 className="truncate font-semibold text-slate-900">{a.name}</h3>
                  </div>
                  {owned ? (
                    <Badge variant="success" size="sm">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      {t('hummytummy.marketplace.owned', { defaultValue: 'Sahip' })}
                    </Badge>
                  ) : includedInPlan ? (
                    <Badge variant="success" size="sm">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      {t('hummytummy.marketplace.includedInPlan', {
                        defaultValue: 'Planınıza dahil',
                      })}
                    </Badge>
                  ) : (
                    <Badge variant="default" size="sm">
                      {t(`hummytummy.marketplace.filter.${a.kind}`, {
                        defaultValue: a.kind,
                      })}
                    </Badge>
                  )}
                </div>

                <p className="mb-3 flex-1 text-sm text-slate-600">{a.description}</p>

                {a.deps.length > 0 && (
                  <p className="mb-3 flex items-center gap-1.5 text-xs text-amber-700">
                    <Link2 className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>
                      {t('hummytummy.marketplace.requires')} {a.deps.join(', ')}
                    </span>
                  </p>
                )}

                <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-lg font-semibold text-slate-900">
                    {(a.priceCents / 100).toLocaleString('tr-TR', {
                      style: 'currency',
                      currency: a.currency,
                    })}
                    {a.billing === 'recurring' && (
                      <span className="text-xs font-normal text-slate-500"> / mo</span>
                    )}
                  </span>
                  {owned ? (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" />
                      {t('hummytummy.marketplace.active', { defaultValue: 'Etkin' })}
                    </span>
                  ) : includedInPlan ? (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" />
                      {t('hummytummy.marketplace.includedInPlan', {
                        defaultValue: 'Planınıza dahil',
                      })}
                    </span>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      // Disable until ownership is known (the /addons/mine query
                      // may still be loading), so an already-owned add-on can't
                      // be re-bought in the catalogue-rendered-but-mine-pending
                      // window.
                      disabled={purchase.isPending || mineLoading}
                      onClick={() => handlePurchase(a.code)}
                    >
                      <ShoppingCart className="mr-1.5 h-4 w-4" />
                      {isBusy
                        ? t('hummytummy.marketplace.purchasing', {
                            defaultValue: 'Satın alınıyor…',
                          })
                        : t('hummytummy.marketplace.purchase')}
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Your add-ons */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('hummytummy.marketplace.mine')}
        </h2>
        {mineLoading ? (
          <p className="text-sm text-slate-500">{t('hummytummy.common.loading')}</p>
        ) : mine.length === 0 ? (
          <Card variant="bordered" className="flex flex-col items-center gap-2 p-8 text-center">
            <Inbox className="h-7 w-7 text-slate-300" />
            <p className="text-sm text-slate-500">
              {t('hummytummy.marketplace.mineEmpty')}
            </p>
          </Card>
        ) : (
          <Card variant="bordered" className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">
                      {t('hummytummy.marketplace.col.addOn')}
                    </th>
                    <th className="px-4 py-3 font-medium">
                      {t('hummytummy.marketplace.col.quantity')}
                    </th>
                    <th className="px-4 py-3 font-medium">
                      {t('hummytummy.marketplace.col.status')}
                    </th>
                    <th className="px-4 py-3 font-medium">
                      {t('hummytummy.marketplace.col.periodEnds')}
                    </th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {mine.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{row.addOn.name}</div>
                        <div className="font-mono text-xs text-slate-400">
                          {row.addOn.code}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.quantity}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={STATUS_VARIANT[row.status] ?? 'default'}
                            size="sm"
                          >
                            {row.status}
                          </Badge>
                          {row.cancelAtPeriodEnd && (
                            <Badge variant="warning" size="sm">
                              <AlertTriangle className="mr-1 h-3 w-3" />
                              {t('hummytummy.marketplace.cancelAtPeriodEnd')}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.currentPeriodEnd
                          ? new Date(row.currentPeriodEnd).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {row.status === 'active' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            disabled={cancel.isPending}
                            onClick={() => handleCancel(row.id, row.addOn.name)}
                          >
                            {t('hummytummy.common.cancel')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
