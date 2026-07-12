import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface DateRange {
  startDate: string; // yyyy-MM-dd
  endDate: string; // yyyy-MM-dd
}

/**
 * Compact shared date-range picker for report tabs that used to be locked to
 * a fixed window (CostingPage 30 days, ConsolidatedTab 30 days, …). Draft
 * state is local; the parent only re-queries on an explicit Apply, so typing
 * a date doesn't fire a request per keystroke.
 */
export default function DateRangeBar({
  value,
  onApply,
  className = '',
}: {
  value: DateRange;
  onApply: (range: DateRange) => void;
  className?: string;
}) {
  const { t } = useTranslation('reports');
  const [draft, setDraft] = useState<DateRange>(value);
  const invalid =
    !draft.startDate || !draft.endDate || draft.startDate > draft.endDate;
  return (
    <form
      className={`flex flex-wrap items-end gap-2 ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) onApply(draft);
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        {t('reports.from')}
        <input
          type="date"
          value={draft.startDate}
          onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
          className="rounded-md border-slate-300 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        {t('reports.to')}
        <input
          type="date"
          value={draft.endDate}
          onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
          className="rounded-md border-slate-300 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={invalid}
        className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {t('common:buttons.apply')}
      </button>
    </form>
  );
}

/**
 * Month picker sibling for month-keyed reports (BudgetTab). Emits on change —
 * a single input needs no Apply gesture.
 */
export function MonthBar({
  year,
  month,
  onChange,
  className = '',
}: {
  year: number;
  month: number; // 1-12
  onChange: (ym: { year: number; month: number }) => void;
  className?: string;
}) {
  const { t } = useTranslation('reports');
  return (
    <label className={`flex flex-col gap-1 text-xs text-slate-500 ${className}`}>
      {t('budget.monthLabel')}
      <input
        type="month"
        value={`${year}-${String(month).padStart(2, '0')}`}
        onChange={(e) => {
          const [y, m] = e.target.value.split('-').map(Number);
          if (y && m) onChange({ year: y, month: m });
        }}
        className="rounded-md border-slate-300 text-sm"
      />
    </label>
  );
}
