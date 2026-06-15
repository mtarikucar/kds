import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Plan } from '../../types';

interface PlanComparisonMatrixProps {
  plans: Plan[];
}

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
  // flag as a top-level boolean on `plan.features`.
  const featureRows: Array<{ key: keyof Plan['features']; label: string }> = [
    { key: 'kdsIntegration', label: t('subscriptions.comparison.features.kdsIntegration') },
    { key: 'inventoryTracking', label: t('subscriptions.comparison.features.inventoryTracking') },
    { key: 'advancedReports', label: t('subscriptions.comparison.features.advancedReports') },
    { key: 'reservationSystem', label: t('subscriptions.comparison.features.reservationSystem') },
    { key: 'personnelManagement', label: t('subscriptions.comparison.features.personnelManagement') },
    { key: 'deliveryIntegration', label: t('subscriptions.comparison.features.deliveryIntegration') },
    { key: 'multiLocation', label: t('subscriptions.comparison.features.multiLocation') },
    { key: 'customBranding', label: t('subscriptions.comparison.features.customBranding') },
    { key: 'apiAccess', label: t('subscriptions.comparison.features.apiAccess') },
    { key: 'prioritySupport', label: t('subscriptions.comparison.features.prioritySupport') },
  ];

  const limitRows: Array<{ key: keyof Plan['limits']; label: string }> = [
    { key: 'maxUsers', label: t('subscriptions.comparison.limits.maxUsers') },
    { key: 'maxTables', label: t('subscriptions.comparison.limits.maxTables') },
    { key: 'maxProducts', label: t('subscriptions.comparison.limits.maxProducts') },
    { key: 'maxCategories', label: t('subscriptions.comparison.limits.maxCategories') },
    { key: 'maxMonthlyOrders', label: t('subscriptions.comparison.limits.maxMonthlyOrders') },
  ];

  const fmtLimit = (n: number) =>
    n === -1 ? '∞' : n.toLocaleString('tr-TR');

  // Monthly price + ISO currency code per plan, so buyers can compare
  // cost head-to-head inside the matrix (the cards show it, but the
  // matrix should stand on its own for the side-by-side comparison).
  const fmtPrice = (p: Plan) => {
    const monthly = Number(p.monthlyPrice);
    const currency = p.currency || 'TRY';
    if (monthly === 0) return t('subscriptions.comparison.free', 'Ücretsiz');
    return `${monthly.toLocaleString('tr-TR')} ${currency}`;
  };

  return (
    <div className="mt-12 border-t pt-8">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 mx-auto text-slate-700 hover:text-slate-900 font-medium"
      >
        {open ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        {t('subscriptions.comparison.toggle')}
      </button>
      {open && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 pl-4 text-slate-700 font-medium">
                  {t('subscriptions.comparison.featureHeader')}
                </th>
                {sorted.map((p) => (
                  <th key={p.id} className="text-center py-3 px-2 text-slate-900 font-semibold">
                    {p.displayName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Price row — first so the cost is the top reference point
                  when scanning columns. Shows monthly price + currency. */}
              <tr className="border-b border-slate-100">
                <td className="py-2.5 pl-4 text-slate-700 font-medium">
                  {t('subscriptions.comparison.priceRow', 'Fiyat')}
                </td>
                {sorted.map((p) => (
                  <td key={p.id} className="text-center py-2.5 px-2 text-slate-900 font-semibold">
                    {fmtPrice(p)}
                    <span className="block text-xs font-normal text-slate-400">
                      /{t('subscriptions.comparison.perMonth', 'ay')}
                    </span>
                  </td>
                ))}
              </tr>
              {/* Limits group */}
              <tr className="bg-slate-50/50">
                <td colSpan={sorted.length + 1} className="py-2 pl-4 text-xs uppercase tracking-wider text-slate-500 font-medium">
                  {t('subscriptions.comparison.limitsGroup')}
                </td>
              </tr>
              {limitRows.map((row) => (
                <tr key={row.key} className="border-b border-slate-100">
                  <td className="py-2.5 pl-4 text-slate-700">{row.label}</td>
                  {sorted.map((p) => (
                    <td key={p.id} className="text-center py-2.5 px-2 text-slate-900">
                      {fmtLimit(Number(p.limits[row.key]))}
                    </td>
                  ))}
                </tr>
              ))}
              {/* Features group */}
              <tr className="bg-slate-50/50">
                <td colSpan={sorted.length + 1} className="py-2 pl-4 text-xs uppercase tracking-wider text-slate-500 font-medium">
                  {t('subscriptions.comparison.featuresGroup')}
                </td>
              </tr>
              {featureRows.map((row) => (
                <tr key={row.key} className="border-b border-slate-100">
                  <td className="py-2.5 pl-4 text-slate-700">{row.label}</td>
                  {sorted.map((p) => (
                    <td key={p.id} className="text-center py-2.5 px-2">
                      {p.features[row.key] ? (
                        <Check className="w-4 h-4 text-emerald-600 inline-block" />
                      ) : (
                        <X className="w-4 h-4 text-slate-300 inline-block" />
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
