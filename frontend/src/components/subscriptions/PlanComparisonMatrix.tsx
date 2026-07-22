import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Plan, SubscriptionPlanType } from '../../types';
import { cn } from '../../lib/utils';

interface PlanComparisonMatrixProps {
  plans: Plan[];
}

const display = { fontFamily: '"Fraunces", Georgia, serif' } as const;

/**
 * Collapsible "compare plans side-by-side" table shown under the
 * pricing cards. Most users decide on the cards alone; the matrix is
 * for the long-tail of buyers who want every checkbox before committing.
 */
export default function PlanComparisonMatrix({ plans }: PlanComparisonMatrixProps) {
  const { t } = useTranslation('subscriptions');
  const [open, setOpen] = useState(false);

  // Sort cheapest → expensive so columns match the cards above.
  const sorted = [...plans].sort((a, b) => Number(a.monthlyPrice) - Number(b.monthlyPrice));

  // Feature keys mapped to readable labels. The plan object stores each
  // flag as a top-level boolean on `plan.features`. All 13 features are
  // listed so the matrix is an exhaustive, accurate side-by-side.
  const featureRows: Array<{ key: keyof Plan['features']; label: string }> = [
    { key: 'kdsIntegration', label: t('subscriptions.comparison.features.kdsIntegration') },
    { key: 'posAccess', label: t('subscriptions.comparison.features.posAccess') },
    { key: 'inventoryTracking', label: t('subscriptions.comparison.features.inventoryTracking') },
    { key: 'advancedReports', label: t('subscriptions.comparison.features.advancedReports') },
    { key: 'reservationSystem', label: t('subscriptions.comparison.features.reservationSystem') },
    { key: 'personnelManagement', label: t('subscriptions.comparison.features.personnelManagement') },
    { key: 'deliveryIntegration', label: t('subscriptions.comparison.features.deliveryIntegration') },
    { key: 'externalDisplay', label: t('subscriptions.comparison.features.externalDisplay') },
    { key: 'aiContentGeneration', label: t('subscriptions.comparison.features.aiContentGeneration') },
    { key: 'multiLocation', label: t('subscriptions.comparison.features.multiLocation') },
    { key: 'customBranding', label: t('subscriptions.comparison.features.customBranding') },
    { key: 'apiAccess', label: t('subscriptions.comparison.features.apiAccess') },
    { key: 'prioritySupport', label: t('subscriptions.comparison.features.prioritySupport') },
  ];

  const limitRows: Array<{ key: keyof Plan['limits']; label: string }> = [
    { key: 'maxUsers', label: t('subscriptions.comparison.limits.maxUsers') },
    { key: 'maxTables', label: t('subscriptions.comparison.limits.maxTables') },
    { key: 'maxBranches', label: t('subscriptions.comparison.limits.maxBranches') },
    { key: 'maxProducts', label: t('subscriptions.comparison.limits.maxProducts') },
    { key: 'maxCategories', label: t('subscriptions.comparison.limits.maxCategories') },
    { key: 'maxMonthlyOrders', label: t('subscriptions.comparison.limits.maxMonthlyOrders') },
    { key: 'maxMonthlyAiPhotos', label: t('subscriptions.comparison.limits.maxMonthlyAiPhotos') },
    { key: 'maxMonthlyAiVideos', label: t('subscriptions.comparison.limits.maxMonthlyAiVideos') },
    { key: 'maxMonthlyAi3dModels', label: t('subscriptions.comparison.limits.maxMonthlyAi3dModels') },
  ];

  // Defends against a missing/undefined limit key on the plan payload
  // (e.g. a backend mapper mirror that drifted out of sync with the plan
  // record — Number(undefined) is NaN, and NaN.toLocaleString() renders the
  // literal string "NaN" in the cell). Render an em dash instead of a
  // confusing "NaN" for any non-finite value.
  const fmtLimit = (n: number) => {
    if (n === -1) return '∞';
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('tr-TR');
  };

  // Monthly price + ISO currency code per plan, so buyers can compare
  // cost head-to-head inside the matrix (the cards show it, but the
  // matrix should stand on its own for the side-by-side comparison).
  const fmtPrice = (p: Plan) => {
    const monthly = Number(p.monthlyPrice);
    const currency = p.currency || 'TRY';
    if (monthly === 0) return t('subscriptions.comparison.free', 'Ücretsiz');
    return `${monthly.toLocaleString('tr-TR')} ${currency}`;
  };

  // BUSINESS is the highlighted ("En Popüler") tier — tint its column so the
  // matrix is visually consistent with the elevated card above.
  const isHighlighted = (p: Plan) => p.name === SubscriptionPlanType.BUSINESS;

  return (
    <div className="mt-12 border-t border-[#ece2d4] pt-8">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 mx-auto rounded-xl border border-[#e3d7c7] bg-white px-5 py-2.5 text-sm font-semibold text-[#1c1917] shadow-sm transition hover:border-[#f5c9a3] hover:bg-[#fff3e8]"
      >
        {open ? <ChevronUp className="w-4 h-4 text-[#f97316]" /> : <ChevronDown className="w-4 h-4 text-[#f97316]" />}
        {t('subscriptions.comparison.toggle')}
      </button>
      {open && (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-[#ece2d4] bg-white shadow-sm shadow-stone-900/5">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#ece2d4]">
                <th className="text-left py-4 pl-5 text-[#78716c] font-medium">
                  {t('subscriptions.comparison.featureHeader')}
                </th>
                {sorted.map((p) => (
                  <th
                    key={p.id}
                    className={cn(
                      'text-center py-4 px-3 text-base font-semibold text-[#1c1917]',
                      isHighlighted(p) && 'bg-[#fff3e8]',
                    )}
                    style={display}
                  >
                    {p.displayName}
                    {isHighlighted(p) && (
                      <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-[#b45309]">
                        ⭐ {t('subscriptions.comparison.popularBadge', 'En Popüler')}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Price row — first so the cost is the top reference point
                  when scanning columns. Shows monthly price + currency. */}
              <tr className="border-b border-[#f1e8db]">
                <td className="py-3 pl-5 text-[#57534e] font-medium">
                  {t('subscriptions.comparison.priceRow', 'Fiyat')}
                </td>
                {sorted.map((p) => (
                  <td
                    key={p.id}
                    className={cn(
                      'text-center py-3 px-3 font-semibold text-[#1c1917]',
                      isHighlighted(p) && 'bg-[#fff3e8]',
                    )}
                  >
                    <span style={display}>{fmtPrice(p)}</span>
                    <span className="block text-xs font-normal text-[#a8a29e]">
                      /{t('subscriptions.comparison.perMonth', 'ay')}
                    </span>
                  </td>
                ))}
              </tr>
              {/* Limits group */}
              <tr className="bg-[#faf6f0]">
                <td colSpan={sorted.length + 1} className="py-2 pl-5 text-xs uppercase tracking-wider text-[#a8a29e] font-semibold">
                  {t('subscriptions.comparison.limitsGroup')}
                </td>
              </tr>
              {limitRows.map((row) => (
                <tr key={row.key} className="border-b border-[#f1e8db]">
                  <td className="py-3 pl-5 text-[#57534e]">{row.label}</td>
                  {sorted.map((p) => (
                    <td
                      key={p.id}
                      className={cn(
                        'text-center py-3 px-3 text-[#1c1917]',
                        isHighlighted(p) && 'bg-[#fff3e8] font-medium',
                      )}
                    >
                      {fmtLimit(Number(p.limits[row.key]))}
                    </td>
                  ))}
                </tr>
              ))}
              {/* Features group */}
              <tr className="bg-[#faf6f0]">
                <td colSpan={sorted.length + 1} className="py-2 pl-5 text-xs uppercase tracking-wider text-[#a8a29e] font-semibold">
                  {t('subscriptions.comparison.featuresGroup')}
                </td>
              </tr>
              {featureRows.map((row) => (
                <tr key={row.key} className="border-b border-[#f1e8db] last:border-0">
                  <td className="py-3 pl-5 text-[#57534e]">{row.label}</td>
                  {sorted.map((p) => (
                    <td
                      key={p.id}
                      className={cn(
                        'text-center py-3 px-3',
                        isHighlighted(p) && 'bg-[#fff3e8]',
                      )}
                    >
                      {p.features[row.key] ? (
                        <Check className="w-4 h-4 text-[#f97316] inline-block" />
                      ) : (
                        <X className="w-4 h-4 text-[#d6ccbd] inline-block" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
