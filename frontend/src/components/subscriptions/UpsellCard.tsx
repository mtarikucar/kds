import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock, CreditCard, Store } from 'lucide-react';
import { useEntitlements } from '../../contexts/SubscriptionContext';
import { formatCents } from '../../features/licensing/licensingApi';

interface UpsellCardProps {
  /**
   * The à-la-carte catalog code of the product that unlocks this screen
   * (e.g. `module_inventory`). It drives BOTH the store deep link
   * (`/admin/store?tab=catalog&focus=<code>`) and the price lookup, so the
   * figure quoted here is the figure checkout charges.
   */
  addOnCode?: string;
  /**
   * The entitlement key the screen needs (e.g. `inventoryTracking`). Used to
   * resolve the cheapest product granting it when `addOnCode` is absent or is
   * not in the tenant's offer set — the same lookup `UpgradePrompt` does.
   */
  featureKey?: string;
  /**
   * The screen belongs to the FREE core (`FREE_BASELINE_GRANTS` on the
   * backend), so landing on this card means access was suppressed for this
   * tenant, not that something is unbought. Hides the price and the buy CTA:
   * there is nothing to sell, the answer is support.
   */
  freeCore?: boolean;
  /** Optional explicit copy, overriding everything derived below. */
  title?: string;
  description?: string;
}

/**
 * Page-root paywall. Used as the `fallback` of `<FeatureGate />` so direct URL
 * access to a screen the tenant has not bought shows an honest offer instead
 * of a 403 toast (or an invisible blank page).
 *
 * The copy is derived from the licensing snapshot, never from a hardcoded
 * table: the module's real name and its real price for THIS tenant today
 * (day-prorated to the licence anniversary) come from the same catalog read
 * checkout prices from. The pre-3.3 version instead named a plan tier passed
 * in as a prop — a second source of pricing truth that could only say
 * "upgrade to PRO", a product that no longer exists.
 *
 * Two CTAs:
 *   - store  → /admin/store?tab=catalog&focus=<code>  (buy the module)
 *   - licence→ /admin/license                          (what you already own)
 */
export default function UpsellCard({
  addOnCode,
  featureKey,
  freeCore,
  title,
  description,
}: UpsellCardProps) {
  const { t } = useTranslation('plan');
  const { offerFor, snapshot, license } = useEntitlements();

  // Prefer the explicitly named product; fall back to "cheapest product that
  // grants the key" so a screen unlocked by several products (delivery: three
  // vendors) still quotes a real price.
  const offer = useMemo(() => {
    const byCode = addOnCode
      ? Object.values(snapshot?.offers ?? {}).find((o) => o.code === addOnCode)
      : undefined;
    return byCode ?? (featureKey ? offerFor(featureKey) : null);
  }, [addOnCode, featureKey, offerFor, snapshot]);

  const focusCode = offer?.code ?? addOnCode;
  const storeHref = focusCode
    ? `/admin/store?tab=catalog&focus=${encodeURIComponent(focusCode)}`
    : '/admin/store?tab=catalog';

  // Every paid module is sold on top of the annual licence, so a tenant
  // without one needs to hear that before they reach checkout.
  const needsLicence =
    license.status === 'none' || license.status === 'expired';
  const isRenewal = license.status === 'expired';

  const heading =
    title ??
    (freeCore
      ? t('upsell.freeCoreTitle', {
          defaultValue: 'Bu ekrana erişiminiz kapalı',
        })
      : offer
        ? t('upsell.moduleTitle', {
            module: offer.name,
            defaultValue: '{{module}} modülü gerekiyor',
          })
        : t('upsell.defaultTitle', {
            defaultValue: 'Bu ekran ücretli bir modüle dahil',
          }));

  const body =
    description ??
    (freeCore
      ? t('upsell.freeCoreDescription', {
          defaultValue:
            'Bu ekran ücretsiz çekirdeğe dahildir, ancak hesabınızda kapatılmış görünüyor. Destek ekibimizle iletişime geçin.',
        })
      : offer
        ? t('upsell.moduleDescription', {
            module: offer.name,
            defaultValue:
              'Bu ekran {{module}} modülüne dahildir (yıllık, lisans ön koşuluyla).',
          })
        : t('upsell.defaultDescription', {
            defaultValue:
              'Bu ekranı açmak için ilgili modülü yıllık olarak edinmeniz gerekir. Ücretli modüller yıllık lisans ön koşuluyla satılır.',
          }));

  // Lead with the prorated figure: a module bought in month ten costs a tenth
  // of the year, and quoting the list price would overstate the charge.
  const priceLine =
    !freeCore && offer
      ? offer.proratedCents === offer.annualPriceCents
        ? `${formatCents(offer.annualPriceCents, offer.currency)} ${t(
            'upsell.perYear',
            { defaultValue: '/yıl' },
          )}`
        : t('upsell.proratedPrice', {
            prorated: formatCents(offer.proratedCents, offer.currency),
            annual: formatCents(offer.annualPriceCents, offer.currency),
            defaultValue: 'Bugün alırsanız {{prorated}} (yıllık {{annual}})',
          })
      : null;

  const storeCtaLabel = offer
    ? isRenewal
      ? t('upsell.renewCta', { defaultValue: 'Yenile' })
      : t('upsell.buyCta', { defaultValue: 'Satın al' })
    : t('upsell.viewAddOnCta', { defaultValue: 'Mağazada incele' });

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-amber-50 p-3 text-amber-700">
            <Lock className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-slate-900">{heading}</h2>
            <p className="mt-2 text-sm text-slate-600">{body}</p>

            {priceLine && (
              <p className="mt-3 text-sm font-medium text-slate-900">
                {priceLine}
              </p>
            )}

            {!freeCore && needsLicence && (
              <p className="mt-2 text-sm text-amber-700">
                {t('upsell.licenceRequired', {
                  defaultValue:
                    'Ücretli modülleri açabilmek için önce yıllık lisans gerekir.',
                })}
              </p>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              {!freeCore && (
                <Link
                  to={storeHref}
                  className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  <Store className="h-4 w-4" />
                  {storeCtaLabel}
                </Link>
              )}
              <Link
                to="/admin/license"
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <CreditCard className="h-4 w-4" />
                {t('upsell.viewLicenceCta', {
                  defaultValue: 'Lisansım ve modüllerim',
                })}
              </Link>
            </div>

            <p className="mt-6 text-xs text-slate-500">
              {t('upsell.helpHint', {
                defaultValue:
                  'Sorularınız için destek ekibimizle iletişime geçebilirsiniz.',
              })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
