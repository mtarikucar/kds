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
import DateRangeBar, { MonthBar } from './DateRangeBar';
import {
  useConsolidatedPnl,
  useSalesForecast,
} from '../../../features/reports/reportsApi';
import {
  useBudgetVsActual,
  useSetBudget,
  EXPENSE_CATEGORIES,
} from '../../../features/expenses/expensesApi';

/**
 * Management-analysis tabs that used to live (confusingly) under
 * "Muhasebe & e-Belge". They are business reports, not legal e-documents, so
 * they belong with the other Raporlar tabs. Rendered by ReportsPage.
 */

export function BudgetTab() {
  const { t } = useTranslation('reports');
  const fmt = useFormatCurrency();
  const now = new Date();
  const [ym, setYm] = useState({
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  });
  const { data, isLoading, isError } = useBudgetVsActual(ym.year, ym.month);
  const setBudget = useSetBudget();
  const [category, setCategory] = useState('OTHER');
  const [amount, setAmount] = useState('');
  const catLabel = (c: string) => t(`finance.categories.${c}`, c);
  const save = () => {
    if (!(Number(amount) >= 0) || amount === '') return;
    setBudget.mutate(
      { category, year: ym.year, month: ym.month, amount: Number(amount) },
      { onSuccess: () => setAmount(''), onError: () => undefined },
    );
  };
  if (isLoading) return <Loading />;
  if (isError) return <LoadError />;
  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <CardTitle>
          {t('budget.title')} — {ym.year}/{ym.month} ({t('budget.varianceLabel')}{' '}
          {fmt(data?.totalVariance ?? 0)})
        </CardTitle>
        <MonthBar year={ym.year} month={ym.month} onChange={setYm} />
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end rounded-lg bg-slate-50 p-3">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border-slate-300 text-sm"
            aria-label={t('finance.category')}
          >
            {EXPENSE_CATEGORIES.map((c: string) => (
              <option key={c} value={c}>
                {catLabel(c)}
              </option>
            ))}
          </select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            min="0"
            step="0.01"
            placeholder={t('budget.amountPlaceholder', {
              period: `${ym.year}/${ym.month}`,
            })}
            className="rounded-md border-slate-300 text-sm"
          />
          <button
            onClick={save}
            disabled={setBudget.isPending || amount === ''}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {setBudget.isPending ? t('finance.saving') : t('budget.setBudget')}
          </button>
          {setBudget.isError && (
            <p className="sm:col-span-3 text-xs text-rose-600">
              {t('budget.saveError')}
            </p>
          )}
        </div>
        <Table
          head={[
            t('finance.category'),
            t('budget.headBudget'),
            t('budget.headActual'),
            t('budget.headVariance'),
          ]}
          rows={(data?.byCategory ?? []).map((c: any) => [
            catLabel(c.category),
            fmt(c.budget),
            fmt(c.actual),
            (c.overBudget ? '▲ ' : '') + fmt(c.variance),
          ])}
        />
      </CardContent>
    </Card>
  );
}

export function ConsolidatedTab() {
  const { t } = useTranslation('reports');
  const fmt = useFormatCurrency();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [range, setRange] = useState({
    startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    endDate: today,
  });
  const { data, isLoading, isError, error } = useConsolidatedPnl(range);
  if (isLoading) return <Loading />;
  // Only a 403 means a permissions problem; a 500/network failure gets an
  // honest retry message instead of a misleading access claim.
  if (isError)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-amber-700">
          {(error as any)?.response?.status === 403
            ? t('consolidated.forbidden')
            : t('reports.loadError')}
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <CardTitle>
          {t('consolidated.title')} ({t('consolidated.netLabel')}{' '}
          {fmt(data?.totals?.netProfit ?? 0)})
        </CardTitle>
        <DateRangeBar value={range} onApply={setRange} />
      </CardHeader>
      <CardContent>
        <Table
          head={[
            t('consolidated.headBranch'),
            t('finance.revenue'),
            t('finance.cogs'),
            t('consolidated.headExpenses'),
            t('finance.netProfit'),
            t('consolidated.headNetPct'),
          ]}
          rows={(data?.perBranch ?? []).map((b: any) => [
            b.branchName,
            fmt(b.revenue),
            fmt(b.cogs),
            fmt(b.operatingExpenses),
            fmt(b.netProfit),
            b.netMarginPct != null ? `%${b.netMarginPct}` : '—',
          ])}
        />
      </CardContent>
    </Card>
  );
}

export function ForecastTab() {
  const { t } = useTranslation('reports');
  const fmt = useFormatCurrency();
  const { data, isLoading, isError } = useSalesForecast();
  if (isLoading) return <Loading />;
  if (isError) return <LoadError />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('forecastTab.title', {
            days: data?.horizonDays ?? 7,
            total: fmt(data?.projectedTotal ?? 0),
          })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-slate-500">
          {t('forecastTab.method', {
            method: data?.method ?? '—',
            avg: fmt(data?.avgDailyRevenue ?? 0),
          })}
        </p>
        <Table
          head={[t('forecastTab.headDate'), t('forecastTab.headRevenue')]}
          rows={(data?.forecast ?? []).map((f: any) => [
            f.date,
            fmt(f.forecastRevenue),
          ])}
        />
      </CardContent>
    </Card>
  );
}

function Loading() {
  const { t } = useTranslation('reports');
  return (
    <div className="py-12 text-center text-slate-400">{t('reports.loading')}</div>
  );
}
function LoadError() {
  const { t } = useTranslation('reports');
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-amber-700">
        {t('reports.loadError')}
      </CardContent>
    </Card>
  );
}
function Table({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) {
  const { t } = useTranslation('reports');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={head.length}
                className="py-6 text-center text-slate-400"
              >
                {t('reports.noRecords')}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                {r.map((c, j) => (
                  <td key={j} className="py-2 pr-4 tabular-nums">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
