import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../../components/ui/Card';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import DateRangeBar from '../reports/DateRangeBar';
import {
  useMenuEngineering,
  useUsageVariance,
} from '../../../features/stock-management/costingApi';
import { useRecipes } from '../../../features/stock-management/stockManagementApi';
import RecipesTab from '../../../features/stock-management/components/RecipesTab';

const CLASS_TONE: Record<string, string> = {
  STAR: 'bg-emerald-100 text-emerald-700',
  PLOWHORSE: 'bg-sky-100 text-sky-700',
  PUZZLE: 'bg-amber-100 text-amber-700',
  DOG: 'bg-rose-100 text-rose-700',
};

const defaultRange = () => ({
  startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
  endDate: format(new Date(), 'yyyy-MM-dd'),
});

type Fmt = (n: number) => string;

// Reçete & Maliyet = recipe CRUD (from the old inventory group) + costing,
// menu engineering, usage variance (lifted verbatim, incl. its
// ADVANCED_REPORTS 403 'upgrade required' special-case for the
// menu-engineering block) from CostingPage.
export default function CostingTab() {
  const fmt = useFormatCurrency();
  return (
    <div className="space-y-8">
      <RecipesTab />
      <MenuTab fmt={fmt} />
      <VarianceTab fmt={fmt} />
      <RecipeCostingSection fmt={fmt} />
    </div>
  );
}

// ── Menu engineering + usage variance + recipe costing, lifted verbatim
// from CostingPage.tsx ──

function MenuTab({ fmt }: { fmt: Fmt }) {
  const { t } = useTranslation('reports');
  const [range, setRange] = useState(defaultRange);
  const { data, isLoading, isError, error } = useMenuEngineering(range);
  if (isLoading) return <Loading />;
  // Backend gates menu-engineering on ADVANCED_REPORTS while this page is
  // inventoryTracking-gated — a BASIC tenant 403s here. Say so instead of
  // rendering a misleading empty table. Only a 403 means "upgrade"; any other
  // failure (500/network) gets an honest retry message, not purchase advice.
  if (isError)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-amber-700">
          {(error as any)?.response?.status === 403
            ? t('costing.upgradeRequired')
            : t('reports.loadError')}
        </CardContent>
      </Card>
    );
  const items: any[] = data?.items ?? data ?? [];
  const uncostedCount = data?.counts?.uncosted ?? (data?.uncosted?.length ?? 0);
  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <CardTitle>{t('costing.menuTitle')}</CardTitle>
        <DateRangeBar value={range} onApply={setRange} />
      </CardHeader>
      <CardContent>
        {uncostedCount > 0 && (
          <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {t('costing.uncosted', { count: uncostedCount })}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500">
              <th className="py-2 pr-4">{t('costing.headProduct')}</th>
              <th>{t('costing.headUnits')}</th>
              <th>{t('costing.headCost')}</th>
              <th>{t('costing.headPrice')}</th>
              <th>{t('costing.headMargin')}</th>
              <th>{t('costing.headClass')}</th>
            </tr></thead>
            <tbody>
              {items.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-slate-400">{t('reports.noRecords')}</td></tr>
              : items.map((it: any, i: number) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="py-2 pr-4">{it.productName ?? it.name}</td>
                  <td className="tabular-nums">{it.unitsSold ?? it.quantitySold ?? '—'}</td>
                  <td className="tabular-nums">{it.unitCost != null ? fmt(it.unitCost) : '—'}</td>
                  <td className="tabular-nums">{it.unitPrice != null ? fmt(it.unitPrice) : '—'}</td>
                  <td className="tabular-nums">{it.unitMargin != null ? fmt(it.unitMargin) : '—'}</td>
                  <td>{it.classification && <span className={`rounded-full px-2 py-0.5 text-xs ${CLASS_TONE[it.classification] ?? 'bg-slate-100'}`}>{it.classification}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function VarianceTab({ fmt }: { fmt: Fmt }) {
  const { t } = useTranslation('reports');
  const [range, setRange] = useState(defaultRange);
  const { data, isLoading, isError } = useUsageVariance(range);
  if (isLoading) return <Loading />;
  if (isError)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-amber-700">
          {t('reports.loadError')}
        </CardContent>
      </Card>
    );
  const rows: any[] = data?.items ?? data ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <CardTitle>{t('costing.varianceTitle')}</CardTitle>
        <DateRangeBar value={range} onApply={setRange} />
      </CardHeader>
      <CardContent>
        {/* Backend keys: theoreticalUsage, wasteUsage, countVarianceQty, varianceValue, variancePct */}
        <Table
          head={[
            t('costing.headItem'),
            t('costing.headTheoretical'),
            t('costing.headWaste'),
            t('costing.headCountVariance'),
            t('costing.headCostImpact'),
            '%',
          ]}
          rows={rows.map((r: any) => [
            r.name ?? r.stockItemName ?? '—',
            r.theoreticalUsage != null ? String(r.theoreticalUsage) : '—',
            r.wasteUsage != null ? String(r.wasteUsage) : '—',
            r.countVarianceQty != null ? String(r.countVarianceQty) : '—',
            r.varianceValue != null ? fmt(r.varianceValue) : '—',
            r.variancePct != null ? `%${r.variancePct}` : '—',
          ])} />
      </CardContent>
    </Card>
  );
}

// Lifted from CostingPage.tsx's local `RecipesTab` (renamed here to avoid
// clashing with the imported CRUD `RecipesTab` above).
function RecipeCostingSection({ fmt }: { fmt: Fmt }) {
  const { t } = useTranslation('reports');
  const { data, isLoading, isError } = useRecipes();
  if (isLoading) return <Loading />;
  if (isError)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-amber-700">
          {t('reports.loadError')}
        </CardContent>
      </Card>
    );
  const recipes: any[] = (data as any) ?? [];
  return (
    <Card>
      <CardHeader><CardTitle>{t('costing.recipesTitle')}</CardTitle></CardHeader>
      <CardContent>
        <Table
          head={[
            t('costing.headRecipe'),
            t('costing.headPortionCost'),
            t('costing.headFoodCostPct'),
            t('costing.headGrossMargin'),
          ]}
          rows={recipes.map((r: any) => [
            r.name ?? r.product?.name ?? '—',
            r.costing?.costPerPortion != null ? fmt(r.costing.costPerPortion) : '—',
            r.costing?.foodCostPct != null ? `%${r.costing.foodCostPct}` : '—',
            r.costing?.grossMargin != null ? fmt(r.costing.grossMargin) : '—',
          ])} />
      </CardContent>
    </Card>
  );
}

function Loading() {
  const { t } = useTranslation('reports');
  return <div className="py-12 text-center text-slate-400">{t('reports.loading')}</div>;
}
function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  const { t } = useTranslation('reports');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500">{head.map((h) => <th key={h} className="py-2 pr-4">{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={head.length} className="py-6 text-center text-slate-400">{t('reports.noRecords')}</td></tr>
          : rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="py-2 pr-4 tabular-nums">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
