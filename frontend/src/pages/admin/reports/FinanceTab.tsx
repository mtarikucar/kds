import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Receipt,
  Plus,
  Pencil,
  Trash2,
  Flame,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../../components/ui/Card';
import Modal from '../../../components/ui/Modal';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import {
  useProfitAndLoss,
  useLaborReport,
  useCogsReport,
} from '../../../features/reports/reportsApi';
import {
  useExpenseSummary,
  useCreateExpense,
  useExpenses,
  useUpdateExpense,
  useDeleteExpense,
  EXPENSE_CATEGORIES,
  type Expense,
} from '../../../features/expenses/expensesApi';

interface Props {
  dateRange: { startDate: string; endDate: string; branchId?: string };
}

interface ExpenseForm {
  category: string;
  description: string;
  amount: number;
  expenseDate: string;
}

interface StaffLaborRow {
  userId: string;
  staffName: string;
  role: string | null;
  hours: number;
  laborCost: number;
  hasRate: boolean;
}

/**
 * Financial back-office: P&L (revenue → COGS → gross → OpEx → net), prime cost
 * (COGS + labor), waste cost, per-staff labor breakdown, and the
 * operating-expense ledger with quick entry + row edit. Surfaces the
 * accounting/labor endpoints so an owner can see whether the branch made
 * money without leaving the app.
 */
export default function FinanceTab({ dateRange }: Props) {
  const { t } = useTranslation('reports');
  const fmt = useFormatCurrency();
  const { data: pnl, isLoading: pnlLoading, isError: pnlError } = useProfitAndLoss(dateRange);
  const { data: labor, isLoading: laborLoading, isError: laborError } = useLaborReport(dateRange);
  const { data: cogs, isLoading: cogsLoading, isError: cogsError } = useCogsReport(dateRange);
  const { data: summary } = useExpenseSummary(dateRange);
  const {
    data: expenses,
    isLoading: expensesLoading,
    isError: expensesError,
  } = useExpenses(dateRange);
  const createExpense = useCreateExpense();
  const deleteExpense = useDeleteExpense();

  const { register, handleSubmit, reset } = useForm<ExpenseForm>({
    defaultValues: {
      category: 'OTHER',
      expenseDate: dateRange.endDate,
    },
  });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);

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
  const catLabel = (c: string) => t(`finance.categories.${c}`, c);

  const byStaff: StaffLaborRow[] = labor?.byStaff ?? [];

  return (
    <div className="space-y-6">
      {(pnlError || laborError || cogsError) && (
        <Card>
          <CardContent className="py-4 text-center text-sm text-amber-700">
            {t('reports.loadError')}
          </CardContent>
        </Card>
      )}

      {/* P&L summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Metric label={t('finance.revenue')} value={fmt(pnl?.revenue ?? 0)} icon={DollarSign} tone="slate" loading={pnlLoading} />
        <Metric label={t('finance.cogs')} value={fmt(pnl?.cogs ?? 0)} sub={pct(pnl?.foodCostPct)} icon={Receipt} tone="amber" loading={pnlLoading} />
        <Metric label={t('finance.grossProfit')} value={fmt(pnl?.grossProfit ?? 0)} sub={pct(pnl?.grossMarginPct)} icon={TrendingUp} tone="emerald" loading={pnlLoading} />
        <Metric label={t('finance.operatingExpenses')} value={fmt(pnl?.operatingExpenses ?? 0)} icon={TrendingDown} tone="rose" loading={pnlLoading} />
        <Metric
          label={t('finance.netProfit')}
          value={fmt(pnl?.netProfit ?? 0)}
          sub={pct(pnl?.netMarginPct)}
          icon={pnl && pnl.netProfit >= 0 ? TrendingUp : TrendingDown}
          tone={pnl && pnl.netProfit >= 0 ? 'emerald' : 'rose'}
          loading={pnlLoading}
        />
        <Metric
          label={t('finance.primeCost')}
          value={fmt(labor?.primeCost ?? 0)}
          sub={pct(labor?.primeCostPct)}
          icon={Users}
          tone="indigo"
          loading={laborLoading}
        />
        {/* Waste cost — shrinkage, deliberately reported OUTSIDE COGS by the
            backend; without this card the number was fetched but invisible. */}
        <Metric
          label={t('finance.wasteCost')}
          value={fmt(cogs?.wasteCost ?? 0)}
          sub={pct(cogs?.wasteCostPct)}
          icon={Flame}
          tone="amber"
          loading={cogsLoading}
        />
      </div>

      {/* Labor detail */}
      {labor && (
        <Card>
          <CardHeader>
            <CardTitle>{t('finance.labor')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <KV label={t('finance.laborCost')} value={fmt(labor.laborCost)} />
              <KV label={t('finance.laborPct')} value={pct(labor.laborPct)} />
              <KV label={t('finance.totalHours')} value={String(labor.totalHours)} />
              <KV label={t('finance.salesPerLaborHour')} value={labor.salesPerLaborHour != null ? fmt(labor.salesPerLaborHour) : '—'} />
            </div>
            {labor.staffWithoutRate > 0 && (
              <p className="mt-3 text-xs text-amber-600">
                {t('finance.staffWithoutRate', { count: labor.staffWithoutRate })}
              </p>
            )}

            {/* Per-staff labor cost — returned by /reports/labor all along but
                never rendered before. */}
            {byStaff.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <p className="mb-2 text-sm font-medium text-slate-700">{t('finance.byStaff')}</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-2 pr-4">{t('finance.staff')}</th>
                      <th className="pr-4">{t('finance.role')}</th>
                      <th className="pr-4 text-right">{t('finance.hours')}</th>
                      <th className="text-right">{t('finance.cost')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byStaff.map((s) => (
                      <tr key={s.userId} className="border-t border-slate-100">
                        <td className="py-2 pr-4">
                          {s.staffName}
                          {!s.hasRate && (
                            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
                              {t('finance.noRate')}
                            </span>
                          )}
                        </td>
                        <td className="pr-4 text-slate-500">{s.role ?? '—'}</td>
                        <td className="pr-4 text-right tabular-nums">{s.hours}</td>
                        <td className="text-right tabular-nums">{fmt(s.laborCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Expenses */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('finance.expenses')}</CardTitle>
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            <Plus className="h-4 w-4" /> {t('finance.addExpense')}
          </button>
        </CardHeader>
        <CardContent>
          {showForm && (
            <form
              onSubmit={handleSubmit(onAddExpense)}
              className="mb-4 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end rounded-lg bg-slate-50 p-3"
            >
              <select {...register('category')} className="rounded-md border-slate-300 text-sm" aria-label={t('finance.category')}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{catLabel(c)}</option>
                ))}
              </select>
              <input {...register('description', { required: true })} placeholder={t('finance.description')} className="rounded-md border-slate-300 text-sm sm:col-span-2" />
              <input {...register('amount', { required: true, valueAsNumber: true })} type="number" step="0.01" placeholder={t('finance.amount')} className="rounded-md border-slate-300 text-sm" />
              <input {...register('expenseDate', { required: true })} type="date" className="rounded-md border-slate-300 text-sm" aria-label={t('finance.date')} />
              <button
                type="submit"
                disabled={createExpense.isPending}
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 sm:col-span-5"
              >
                {createExpense.isPending ? t('finance.saving') : t('finance.save')}
              </button>
              {createExpense.isError && (
                <p className="sm:col-span-5 text-xs text-rose-600">{t('finance.saveError')}</p>
              )}
            </form>
          )}

          {/* category summary */}
          {summary?.byCategory?.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {summary.byCategory.map((c: { category: string; amount: number }) => (
                <span key={c.category} className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                  {catLabel(c.category)}: <strong>{fmt(c.amount)}</strong>
                </span>
              ))}
              <span className="rounded-full bg-rose-100 px-3 py-1 text-xs">
                {t('finance.total')}: <strong>{fmt(summary.total)}</strong>
              </span>
            </div>
          )}

          {/* recent expenses */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2">{t('finance.date')}</th>
                  <th>{t('finance.category')}</th>
                  <th>{t('finance.description')}</th>
                  <th className="text-right">{t('finance.amount')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {expensesLoading && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      {t('reports.loading')}
                    </td>
                  </tr>
                )}
                {expensesError && !expensesLoading && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-amber-700">
                      {t('reports.loadError')}
                    </td>
                  </tr>
                )}
                {expenses?.slice(0, 15).map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="py-2 whitespace-nowrap">{e.expenseDate?.slice(0, 10)}</td>
                    <td>{catLabel(e.category)}</td>
                    <td>{e.description}</td>
                    <td className="text-right tabular-nums">{fmt(e.amount)}</td>
                    <td className="text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setEditing(e)}
                        className="mr-2 text-slate-400 hover:text-indigo-600"
                        aria-label={t('finance.edit')}
                        title={t('finance.edit')}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteExpense.mutate(e.id)}
                        disabled={deleteExpense.isPending}
                        className="text-slate-400 hover:text-rose-600 disabled:opacity-50"
                        aria-label={t('finance.delete')}
                        title={t('finance.delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {!expensesLoading && !expensesError && (!expenses || expenses.length === 0) && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      {t('finance.noExpenses')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {editing && (
        <EditExpenseModal expense={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/**
 * Row-edit modal for a recorded expense. Backed by useUpdateExpense
 * (PATCH /expenses/:id) — the endpoint lands in the separate expenses backend
 * PR; until then a save surfaces the error message below.
 */
function EditExpenseModal({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const { t } = useTranslation('reports');
  const updateExpense = useUpdateExpense();
  const { register, handleSubmit } = useForm<ExpenseForm>({
    defaultValues: {
      category: expense.category,
      description: expense.description,
      amount: expense.amount,
      expenseDate: expense.expenseDate?.slice(0, 10),
    },
  });
  const catLabel = (c: string) => t(`finance.categories.${c}`, c);

  const onSave = (data: ExpenseForm) => {
    updateExpense.mutate(
      { id: expense.id, ...data, amount: Number(data.amount) },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal isOpen onClose={onClose} title={t('finance.editExpense')} size="sm">
      <form onSubmit={handleSubmit(onSave)} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">{t('finance.category')}</span>
          <select {...register('category')} className="w-full rounded-md border-slate-300 text-sm">
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{catLabel(c)}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">{t('finance.description')}</span>
          <input {...register('description', { required: true })} className="w-full rounded-md border-slate-300 text-sm" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">{t('finance.amount')}</span>
          <input {...register('amount', { required: true, valueAsNumber: true })} type="number" step="0.01" className="w-full rounded-md border-slate-300 text-sm" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">{t('finance.date')}</span>
          <input {...register('expenseDate', { required: true })} type="date" className="w-full rounded-md border-slate-300 text-sm" />
        </label>
        {updateExpense.isError && (
          <p className="text-xs text-rose-600">{t('finance.updateError')}</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            {t('common:buttons.cancel')}
          </button>
          <button
            type="submit"
            disabled={updateExpense.isPending}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {updateExpense.isPending ? t('finance.saving') : t('finance.save')}
          </button>
        </div>
      </form>
    </Modal>
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
