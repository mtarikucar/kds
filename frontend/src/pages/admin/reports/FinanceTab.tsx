import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Receipt,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../../components/ui/Card';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import {
  useProfitAndLoss,
  useLaborReport,
} from '../../../features/reports/reportsApi';
import {
  useExpenseSummary,
  useCreateExpense,
  useExpenses,
  useDeleteExpense,
  EXPENSE_CATEGORIES,
} from '../../../features/expenses/expensesApi';

interface Props {
  dateRange: { startDate: string; endDate: string };
}

interface ExpenseForm {
  category: string;
  description: string;
  amount: number;
  expenseDate: string;
}

/**
 * Financial back-office: P&L (revenue → COGS → gross → OpEx → net), prime cost
 * (COGS + labor), and the operating-expense ledger with quick entry. Surfaces
 * the accounting/labor endpoints so an owner can see whether the branch made
 * money without leaving the app.
 */
export default function FinanceTab({ dateRange }: Props) {
  const fmt = useFormatCurrency();
  const { data: pnl, isLoading: pnlLoading } = useProfitAndLoss(dateRange);
  const { data: labor } = useLaborReport(dateRange);
  const { data: summary } = useExpenseSummary(dateRange);
  const { data: expenses } = useExpenses(dateRange);
  const createExpense = useCreateExpense();
  const deleteExpense = useDeleteExpense();

  const { register, handleSubmit, reset } = useForm<ExpenseForm>({
    defaultValues: {
      category: 'OTHER',
      expenseDate: dateRange.endDate,
    },
  });

  const [showForm, setShowForm] = useState(false);

  const onAddExpense = (data: ExpenseForm) => {
    createExpense.mutate(
      { ...data, amount: Number(data.amount) },
      {
        onSuccess: () => {
          reset({ category: 'OTHER', expenseDate: dateRange.endDate, description: '', amount: 0 });
          setShowForm(false);
        },
      }
    );
  };

  const pct = (v?: number | null) => (v == null ? '—' : `%${v}`);

  return (
    <div className="space-y-6">
      {/* P&L summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Metric label="Ciro" value={fmt(pnl?.revenue ?? 0)} icon={DollarSign} tone="slate" loading={pnlLoading} />
        <Metric label="SMM (COGS)" value={fmt(pnl?.cogs ?? 0)} sub={pct(pnl?.foodCostPct)} icon={Receipt} tone="amber" loading={pnlLoading} />
        <Metric label="Brüt Kâr" value={fmt(pnl?.grossProfit ?? 0)} sub={pct(pnl?.grossMarginPct)} icon={TrendingUp} tone="emerald" loading={pnlLoading} />
        <Metric label="İşletme Gideri" value={fmt(pnl?.operatingExpenses ?? 0)} icon={TrendingDown} tone="rose" loading={pnlLoading} />
        <Metric
          label="Net Kâr"
          value={fmt(pnl?.netProfit ?? 0)}
          sub={pct(pnl?.netMarginPct)}
          icon={pnl && pnl.netProfit >= 0 ? TrendingUp : TrendingDown}
          tone={pnl && pnl.netProfit >= 0 ? 'emerald' : 'rose'}
          loading={pnlLoading}
        />
        <Metric
          label="Prime Cost (SMM+İşçilik)"
          value={fmt(labor?.primeCost ?? 0)}
          sub={pct(labor?.primeCostPct)}
          icon={Users}
          tone="indigo"
        />
      </div>

      {/* Labor detail */}
      {labor && (
        <Card>
          <CardHeader>
            <CardTitle>İşçilik</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <KV label="İşçilik Maliyeti" value={fmt(labor.laborCost)} />
              <KV label="İşçilik %" value={pct(labor.laborPct)} />
              <KV label="Toplam Saat" value={String(labor.totalHours)} />
              <KV label="Saat Başı Ciro" value={labor.salesPerLaborHour != null ? fmt(labor.salesPerLaborHour) : '—'} />
            </div>
            {labor.staffWithoutRate > 0 && (
              <p className="mt-3 text-xs text-amber-600">
                {labor.staffWithoutRate} personelin saat ücreti tanımlı değil — işçilik maliyeti eksik hesaplanıyor.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Expenses */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Giderler</CardTitle>
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            <Plus className="h-4 w-4" /> Gider Ekle
          </button>
        </CardHeader>
        <CardContent>
          {showForm && (
            <form
              onSubmit={handleSubmit(onAddExpense)}
              className="mb-4 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end rounded-lg bg-slate-50 p-3"
            >
              <select {...register('category')} className="rounded-md border-slate-300 text-sm">
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input {...register('description', { required: true })} placeholder="Açıklama" className="rounded-md border-slate-300 text-sm sm:col-span-2" />
              <input {...register('amount', { required: true, valueAsNumber: true })} type="number" step="0.01" placeholder="Tutar" className="rounded-md border-slate-300 text-sm" />
              <input {...register('expenseDate', { required: true })} type="date" className="rounded-md border-slate-300 text-sm" />
              <button
                type="submit"
                disabled={createExpense.isPending}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 sm:col-span-5"
              >
                {createExpense.isPending ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </form>
          )}

          {/* category summary */}
          {summary?.byCategory?.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {summary.byCategory.map((c: { category: string; amount: number }) => (
                <span key={c.category} className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                  {c.category}: <strong>{fmt(c.amount)}</strong>
                </span>
              ))}
              <span className="rounded-full bg-rose-100 px-3 py-1 text-xs">
                Toplam: <strong>{fmt(summary.total)}</strong>
              </span>
            </div>
          )}

          {/* recent expenses */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2">Tarih</th>
                  <th>Kategori</th>
                  <th>Açıklama</th>
                  <th className="text-right">Tutar</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {expenses?.slice(0, 15).map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="py-2 whitespace-nowrap">{e.expenseDate?.slice(0, 10)}</td>
                    <td>{e.category}</td>
                    <td>{e.description}</td>
                    <td className="text-right tabular-nums">{fmt(e.amount)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => deleteExpense.mutate(e.id)}
                        className="text-slate-400 hover:text-rose-600"
                        aria-label="Sil"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {(!expenses || expenses.length === 0) && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      Bu dönemde gider kaydı yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  icon: Icon,
  tone,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'slate' | 'emerald' | 'rose' | 'amber' | 'indigo';
  loading?: boolean;
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-600',
    emerald: 'bg-emerald-600',
    rose: 'bg-rose-600',
    amber: 'bg-amber-500',
    indigo: 'bg-indigo-600',
  };
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500 mb-1">{label}</p>
            <p className="text-2xl font-bold tabular-nums">{loading ? '…' : value}</p>
            {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
          </div>
          <div className={`p-3 rounded-full ${tones[tone]}`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-500">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}
