import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users,
  Building2,
  Package,
  ShoppingCart,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Store,
} from 'lucide-react';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useGetCurrentSubscription } from '../subscriptions/subscriptionsApi';
import {
  useListAddOns,
  useListMyAddOns,
  useCancelAddOn,
  type MarketplaceAddOn,
} from '../marketplace/marketplaceApi';
import { useGetUsageSnapshot, type UsageDimension } from './planApi';
import SubscriptionManagementSection from '../../pages/settings/SubscriptionSettingsPage';
import Badge from '../../components/ui/Badge';
import type { PlanFeatures } from '../../types';

/**
 * The 13 boolean flags on `PlanFeatures`, labeled. Reuses the labels already
 * shipped for the plan-comparison table
 * (`subscriptions:subscriptions.comparison.features.*` — every locale's
 * subscriptions.json wraps its content under a top-level "subscriptions"
 * key, so the namespace prefix and the JSON's own key both say
 * "subscriptions", mirrored to all 5 locales) instead of inventing a second
 * copy — see `subscriptions.json`. defaultValue below is the tr-TR text,
 * matching this page's existing convention.
 */
const PLAN_FEATURE_FLAGS: Array<{ flag: keyof PlanFeatures; defaultLabel: string }> = [
  { flag: 'advancedReports', defaultLabel: 'Gelişmiş raporlar' },
  { flag: 'multiLocation', defaultLabel: 'Çoklu şube' },
  { flag: 'customBranding', defaultLabel: 'Özel marka' },
  { flag: 'apiAccess', defaultLabel: 'API erişimi' },
  { flag: 'prioritySupport', defaultLabel: 'Öncelikli destek' },
  { flag: 'inventoryTracking', defaultLabel: 'Stok takibi' },
  { flag: 'kdsIntegration', defaultLabel: 'KDS entegrasyonu' },
  { flag: 'reservationSystem', defaultLabel: 'Rezervasyon sistemi' },
  { flag: 'personnelManagement', defaultLabel: 'Personel yönetimi' },
  { flag: 'deliveryIntegration', defaultLabel: 'Yemek platformu entegrasyonu' },
  { flag: 'posAccess', defaultLabel: 'POS / Satış ekranı' },
  { flag: 'externalDisplay', defaultLabel: 'Uzak ekran & Partner API' },
  { flag: 'aiContentGeneration', defaultLabel: 'Yapay Zeka Menü Stüdyosu' },
];

/**
 * v2.8.88 — top-level Plan & Erişim sayfası.
 *
 * Pre-v2.8.88 plan/billing visibility was buried under
 * `/admin/settings/subscription`. Now it's a first-class sidebar
 * destination — same page bundles:
 *   1. Current plan card + next-billing + "Planı değiştir" CTA.
 *   2. Quota cards (users / branches / products / monthly orders),
 *      colored green / amber / red as utilisation crosses 80% / 100%,
 *      with an upgrade CTA to /subscription/change-plan once full.
 *   3. Dahil (Included) band — the plan's ON boolean features plus
 *      catalog add-ons the plan already grants (`includedInPlan === true`).
 *      Reuses MarketplacePage's "Planınıza dahil" badge treatment.
 *   4. Active add-ons list with renewal date + cancel CTA.
 *   5. Satın alınabilir (Purchasable) — suggested add-ons grid, FAIL-CLOSED:
 *      only `includedInPlan === false` is ever offered for sale. An
 *      `undefined` value (shape drift / stale cache) is shown nowhere.
 */
export default function PlanAndAccessPage() {
  const { t } = useTranslation('plan');
  const { data: subscription } = useGetCurrentSubscription();
  const { plan, hasFeature } = useSubscription();
  const { data: snapshot } = useGetUsageSnapshot();
  const { data: catalog = [] } = useListAddOns();
  const { data: myAddOns = [] } = useListMyAddOns();
  const cancelAddOn = useCancelAddOn();

  const ownedCodes = useMemo(
    () => new Set(myAddOns.map((a) => a.addOn?.code).filter(Boolean)),
    [myAddOns],
  );

  // Dahil band — the plan's ON boolean features …
  const includedFeatures = PLAN_FEATURE_FLAGS.filter((f) => hasFeature(f.flag));
  // … plus add-ons the plan already grants (server-computed includedInPlan).
  // Shown, not hidden — the old behavior silently dropped these from
  // suggestions without ever telling the tenant they already have them.
  const includedAddOns = useMemo(
    () => catalog.filter((c) => c.includedInPlan === true),
    [catalog],
  );

  const suggested = useMemo(
    // FAIL-CLOSED (deep-review DEF-9): only offer an add-on for sale when the
    // server has EXPLICITLY said `includedInPlan === false`. The old
    // `!c.includedInPlan` check was fail-OPEN — an `undefined` value (shape
    // drift, a stale cache, a field the server forgot to send) fell through
    // to "suggest it", which can sell a tenant something their plan already
    // covers. `undefined` now means "unknown" and is shown nowhere: neither
    // sold (this list) nor claimed as included (the Dahil band above, which
    // requires `=== true`).
    () =>
      catalog
        .filter((c) => c.includedInPlan === false && !ownedCodes.has(c.code))
        .slice(0, 6),
    [catalog, ownedCodes],
  );

  const currency = plan?.currency ?? subscription?.currency ?? 'TRY';
  const fmt = (cents: number) =>
    (cents / 100).toLocaleString('tr-TR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
  const recurringSuffix = t('perMonthSuffix', { defaultValue: '/ay' });
  const unlimitedLabel = t('quota.unlimited', { defaultValue: 'Sınırsız' });
  const upgradeCta = t('quota.upgradeCta', { defaultValue: 'Üst pakete geç →' });
  const includedInPlanLabel = t('common:hummytummy.marketplace.includedInPlan', {
    defaultValue: 'Planınıza dahil',
  });

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          {t('page.title', { defaultValue: 'Plan & Erişim' })}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {t('page.subtitle', {
            defaultValue:
              'Mevcut planınız, kullanım kotalarınız ve aktif eklentilerinizi buradan yönetin.',
          })}
        </p>
      </header>

      {/* Subscription + billing management (current plan, billing cycle,
          cancel/reactivate/renew, scheduled downgrade, plan limits, and the
          invoice history). v3.1.6 — folded in from the old standalone
          /subscription/manage page so plan + billing live on ONE page. */}
      <SubscriptionManagementSection />

      {/* Quota grid */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t('quota.title', { defaultValue: 'Kullanım kotaları' })}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <QuotaCard
            icon={Users}
            label={t('quota.users', { defaultValue: 'Kullanıcılar' })}
            dim={snapshot?.users}
            unlimitedLabel={unlimitedLabel}
            upgradeCta={upgradeCta}
          />
          <QuotaCard
            icon={Building2}
            label={t('quota.branches', { defaultValue: 'Şubeler' })}
            dim={snapshot?.branches}
            unlimitedLabel={unlimitedLabel}
            upgradeCta={upgradeCta}
          />
          <QuotaCard
            icon={Package}
            label={t('quota.products', { defaultValue: 'Ürünler' })}
            dim={snapshot?.products}
            unlimitedLabel={unlimitedLabel}
            upgradeCta={upgradeCta}
          />
          <QuotaCard
            icon={ShoppingCart}
            label={t('quota.monthlyOrders', {
              defaultValue: 'Aylık siparişler',
            })}
            dim={snapshot?.monthlyOrders}
            unlimitedLabel={unlimitedLabel}
            upgradeCta={upgradeCta}
          />
        </div>
      </section>

      {/* Dahil (Included) — plan features that are ON + add-ons the plan
          already grants. Not hidden: the audit found the old page silently
          dropped includedInPlan add-ons from suggestions but never told the
          tenant they already had them. Badge/copy mirrors MarketplacePage's
          "Planınıza dahil" treatment. */}
      {(includedFeatures.length > 0 || includedAddOns.length > 0) && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t('included.title', { defaultValue: 'Planınıza dahil olanlar' })}
          </h2>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-4">
            {includedFeatures.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {includedFeatures.map((f) => (
                  <span
                    key={f.flag}
                    className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t(`subscriptions:subscriptions.comparison.features.${f.flag}`, {
                      defaultValue: f.defaultLabel,
                    })}
                  </span>
                ))}
              </div>
            )}
            {includedAddOns.length > 0 && (
              <div
                className={`grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 ${
                  includedFeatures.length > 0 ? 'mt-4' : ''
                }`}
              >
                {includedAddOns.map((a) => (
                  <div
                    key={a.code}
                    className="rounded-lg border border-emerald-200 bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-slate-900">{a.name}</div>
                      <Badge variant="success" size="sm">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        {includedInPlanLabel}
                      </Badge>
                    </div>
                    {a.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                        {a.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Active add-ons */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t('activeAddOns.title', { defaultValue: 'Aktif eklentiler' })}
        </h2>
        {myAddOns.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
            {t('activeAddOns.empty', {
              defaultValue:
                'Henüz eklentiniz yok. Aşağıdan önerilen eklentilere göz atabilirsiniz.',
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">
                    {t('activeAddOns.col.name', { defaultValue: 'Eklenti' })}
                  </th>
                  <th className="px-4 py-2">
                    {t('activeAddOns.col.price', { defaultValue: 'Fiyat' })}
                  </th>
                  <th className="px-4 py-2">
                    {t('activeAddOns.col.renewal', {
                      defaultValue: 'Yenileme',
                    })}
                  </th>
                  <th className="px-4 py-2 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {myAddOns.map((a) => {
                  const periodEnd = a.currentPeriodEnd
                    ? new Date(a.currentPeriodEnd).toLocaleDateString('tr-TR')
                    : '—';
                  return (
                    <tr key={a.id}>
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-900">
                          {a.addOn?.name ?? a.addOn?.code}
                        </div>
                        <div className="text-xs text-slate-500">
                          {a.quantity > 1 ? `× ${a.quantity}` : ''}{' '}
                          {a.cancelAtPeriodEnd && (
                            <span className="text-amber-700">
                              {t('activeAddOns.scheduledToCancel', {
                                defaultValue: 'Dönem sonu iptal',
                              })}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        {a.addOn?.priceCents != null
                          ? `${fmt(a.addOn.priceCents)}${a.addOn?.billing === 'recurring' ? recurringSuffix : ''}`
                          : '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-700">{periodEnd}</td>
                      <td className="px-4 py-2 text-right">
                        {!a.cancelAtPeriodEnd && (
                          <button
                            type="button"
                            onClick={() =>
                              cancelAddOn.mutate({ id: a.id, immediate: false })
                            }
                            disabled={cancelAddOn.isPending}
                            className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                          >
                            {t('activeAddOns.cancelCta', {
                              defaultValue: 'İptal et',
                            })}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Suggested add-ons */}
      {suggested.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t('suggested.title', { defaultValue: 'Önerilen eklentiler' })}
            </h2>
            <Link
              to="/admin/store?tab=addons"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
            >
              <Store className="h-3.5 w-3.5" />
              {t('suggested.viewAll', {
                defaultValue: 'Tüm pazaryeri',
              })}
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {suggested.map((c) => (
              <SuggestedCard key={c.code} addon={c} fmt={fmt} recurringSuffix={recurringSuffix} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function QuotaCard({
  icon: Icon,
  label,
  dim,
  unlimitedLabel,
  upgradeCta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  dim?: UsageDimension;
  unlimitedLabel: string;
  upgradeCta: string;
}) {
  if (!dim) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <div className="mt-2 text-sm text-slate-400">—</div>
      </div>
    );
  }

  const unlimited = dim.max === -1;
  const pct = unlimited ? 0 : Math.min(100, Math.round((dim.current / Math.max(1, dim.max)) * 100));
  const status =
    unlimited
      ? 'ok'
      : pct >= 100
        ? 'full'
        : pct >= 80
          ? 'warn'
          : 'ok';
  const colors = {
    ok: { ring: 'border-slate-200', bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700', icon: CheckCircle2 },
    warn: { ring: 'border-amber-200', bar: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700', icon: AlertTriangle },
    full: { ring: 'border-rose-200', bar: 'bg-rose-500', chip: 'bg-rose-50 text-rose-700', icon: XCircle },
  }[status];
  const StatusIcon = colors.icon;

  return (
    <div className={`rounded-lg border bg-white p-4 ${colors.ring}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-2 text-slate-500">
          <Icon className="h-4 w-4" />
          {label}
        </span>
        <StatusIcon className={`h-4 w-4 ${status === 'full' ? 'text-rose-500' : status === 'warn' ? 'text-amber-500' : 'text-emerald-500'}`} />
      </div>
      <div className="mt-2 text-xl font-semibold text-slate-900">
        {dim.current} {unlimited ? '' : <span className="text-slate-400 text-base">/ {dim.max}</span>}
      </div>
      {unlimited ? (
        <div className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${colors.chip}`}>{unlimitedLabel}</div>
      ) : (
        <>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full ${colors.bar}`} style={{ width: `${pct}%` }} />
          </div>
          {status !== 'ok' && (
            <Link
              to="/subscription/change-plan"
              className="mt-2 inline-block text-[11px] font-medium text-blue-600 hover:underline"
            >
              {upgradeCta}
            </Link>
          )}
        </>
      )}
    </div>
  );
}

function SuggestedCard({
  addon,
  fmt,
  recurringSuffix,
}: {
  addon: MarketplaceAddOn;
  fmt: (cents: number) => string;
  recurringSuffix: string;
}) {
  return (
    <Link
      to={`/admin/store?tab=addons&focus=${encodeURIComponent(addon.code)}`}
      className="rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/30"
    >
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
          {addon.kind}
        </span>
        <span className="text-sm font-medium text-slate-900">
          {fmt(addon.priceCents)}
          {addon.billing === 'recurring' ? recurringSuffix : ''}
        </span>
      </div>
      <div className="mt-2 font-medium text-slate-900">{addon.name}</div>
      {addon.description && (
        <p className="mt-1 line-clamp-2 text-xs text-slate-600">{addon.description}</p>
      )}
    </Link>
  );
}
