import { useState } from 'react';
import { format, subDays } from 'date-fns';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../../components/ui/Card';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
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
  const fmt = useFormatCurrency();
  const now = new Date();
  const [ym] = useState({
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  });
  const { data, isLoading } = useBudgetVsActual(ym.year, ym.month);
  const setBudget = useSetBudget();
  const [category, setCategory] = useState('OTHER');
  const [amount, setAmount] = useState('');
  const save = () => {
    if (!(Number(amount) >= 0) || amount === '') return;
    setBudget.mutate(
      { category, year: ym.year, month: ym.month, amount: Number(amount) },
      { onSuccess: () => setAmount(''), onError: () => undefined },
    );
  };
  if (isLoading) return <Loading />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Bütçe vs Fiili — {ym.year}/{ym.month} (varyans{' '}
          {fmt(data?.totalVariance ?? 0)})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end rounded-lg bg-slate-50 p-3">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border-slate-300 text-sm"
            aria-label="Kategori"
          >
            {EXPENSE_CATEGORIES.map((c: string) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            min="0"
            step="0.01"
            placeholder={`${ym.year}/${ym.month} bütçesi`}
            className="rounded-md border-slate-300 text-sm"
          />
          <button
            onClick={save}
            disabled={setBudget.isPending || amount === ''}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {setBudget.isPending ? 'Kaydediliyor…' : 'Bütçe belirle'}
          </button>
          {setBudget.isError && (
            <p className="sm:col-span-3 text-xs text-rose-600">
              Bütçe kaydedilemedi — tekrar deneyin.
            </p>
          )}
        </div>
        <Table
          head={['Kategori', 'Bütçe', 'Fiili', 'Varyans']}
          rows={(data?.byCategory ?? []).map((c: any) => [
            c.category,
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
  const fmt = useFormatCurrency();
  const today = format(new Date(), 'yyyy-MM-dd');
  const [range] = useState({
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
            ? 'Konsolide P&L yalnızca tüm şubelere erişimi olan yöneticiler içindir.'
            : 'Rapor yüklenemedi — sayfayı yenileyip tekrar deneyin.'}
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Konsolide Kâr-Zarar (net {fmt(data?.totals?.netProfit ?? 0)})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table
          head={['Şube', 'Ciro', 'SMM', 'Gider', 'Net kâr', 'Net %']}
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
  const fmt = useFormatCurrency();
  const { data, isLoading } = useSalesForecast();
  if (isLoading) return <Loading />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Satış tahmini — {data?.horizonDays ?? 7} gün, tahmini toplam{' '}
          {fmt(data?.projectedTotal ?? 0)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-slate-500">
          Yöntem: {data?.method}. Günlük ort. {fmt(data?.avgDailyRevenue ?? 0)}.
        </p>
        <Table
          head={['Tarih', 'Tahmini ciro']}
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
  return (
    <div className="py-12 text-center text-slate-400">Yükleniyor…</div>
  );
}
function Table({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) {
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
                Kayıt yok.
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
