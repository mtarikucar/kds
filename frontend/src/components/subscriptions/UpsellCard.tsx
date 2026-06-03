import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock, CreditCard, Store } from 'lucide-react';

interface UpsellCardProps {
  /**
   * The marketplace add-on code that would unlock this feature.
   * The CTA includes a deep link to /admin/marketplace?focus=<code>
   * so the buyer lands directly on the right card.
   */
  addOnCode?: string;
  /**
   * The plan name (e.g. "PRO") that bundles the feature, if applicable.
   * The "Pakete Geç" CTA opens /admin/plan with the highlight.
   */
  planName?: string;
  /**
   * Optional explicit copy. If absent we render a generic
   * "this feature isn't in your subscription" message.
   */
  title?: string;
  description?: string;
}

/**
 * v2.8.88 — page-root upsell. Used as the `fallback` of `<FeatureGate />`
 * so direct URL access to a feature the tenant doesn't have shows a
 * friendly upsell instead of a 403 toast (or an invisible blank page).
 *
 * Two CTAs:
 *   - "Pakete Geç" → /admin/plan (the new top-level Plan & Erişim page)
 *   - "Eklentiyi Al" → /admin/marketplace?focus=<addOnCode>
 */
export default function UpsellCard({
  addOnCode,
  planName,
  title,
  description,
}: UpsellCardProps) {
  const { t } = useTranslation('plan');

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-amber-50 p-3 text-amber-700">
            <Lock className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-slate-900">
              {title ??
                t('upsell.defaultTitle', {
                  defaultValue: 'Bu özellik aboneliğinizde yok',
                })}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {description ??
                t('upsell.defaultDescription', {
                  defaultValue:
                    planName
                      ? `Bu sayfayı görüntülemek için ${planName} planına geçmeniz veya ilgili eklentiyi satın almanız gerekir.`
                      : 'Bu sayfayı görüntülemek için planınızı yükseltmeniz veya ilgili eklentiyi satın almanız gerekir.',
                })}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/admin/plan"
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                <CreditCard className="h-4 w-4" />
                {t('upsell.upgradePlanCta', { defaultValue: 'Pakete Geç' })}
              </Link>
              {addOnCode && (
                <Link
                  to={`/admin/marketplace?focus=${encodeURIComponent(addOnCode)}`}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Store className="h-4 w-4" />
                  {t('upsell.viewAddOnCta', { defaultValue: 'Eklentiyi Gör' })}
                </Link>
              )}
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
