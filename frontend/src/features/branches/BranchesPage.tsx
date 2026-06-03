import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateBranch, useListBranches } from './branchesApi';
import { useGetUsageSnapshot } from '../plan/planApi';

export default function BranchesPage() {
  const { t } = useTranslation('common');
  const { data: branches = [], isLoading } = useListBranches();
  const { data: snapshot } = useGetUsageSnapshot();
  const create = useCreateBranch();
  const [draft, setDraft] = useState({ name: '', code: '', timezone: 'Europe/Istanbul' });

  // v3.0.0 — surface the engine-resolved `branches: {current, max}`
  // dimension from the snapshot. -1 means unlimited (BUSINESS / cap
  // overrides); render an infinity glyph instead of a numerator.
  // The "at limit" state disables the create CTA in the form below
  // and points the user at the marketplace add-on.
  const usage = snapshot?.branches;
  const max = usage?.max ?? Number.POSITIVE_INFINITY;
  const current = usage?.current ?? branches.length;
  const isUnlimited = max === -1;
  const atLimit = !isUnlimited && current >= max;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('hummytummy.branches.title')}</h1>
        {/* v3.0.0 usage meter — shows "Used X/Y" or "Used X/∞" so the
            tenant can self-diagnose before hitting a 403 on create. */}
        {usage ? (
          <span
            className={
              'rounded-full px-3 py-1 text-xs font-medium ' +
              (atLimit
                ? 'bg-amber-100 text-amber-800'
                : 'bg-gray-100 text-gray-700')
            }
            data-testid="branches-usage"
          >
            {t('hummytummy.branches.usage', {
              current,
              max: isUnlimited ? '∞' : max,
              defaultValue: isUnlimited
                ? `Used ${current}/∞ branches`
                : `Used ${current}/${max} branches`,
            })}
          </span>
        ) : null}
      </div>

      <form
        className="flex flex-wrap items-end gap-2 rounded border bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.name || atLimit) return;
          create.mutate(draft, {
            onSuccess: () => setDraft({ name: '', code: '', timezone: 'Europe/Istanbul' }),
          });
        }}
      >
        <Field label={t('hummytummy.branches.name')} value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
        <Field label={t('hummytummy.branches.code')} value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} placeholder="IST-01" />
        <Field label={t('hummytummy.branches.timezone')} value={draft.timezone} onChange={(v) => setDraft((d) => ({ ...d, timezone: v }))} />
        <button
          type="submit"
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={create.isPending || atLimit}
          // Tooltip explains the disabled state when the tenant is
          // at-cap; otherwise the disabled button is a dead-end.
          title={
            atLimit
              ? t('hummytummy.branches.atLimitHint', {
                  defaultValue:
                    'Branch limit reached. Upgrade your plan or buy the extra-branch add-on to add more.',
                })
              : undefined
          }
        >
          {t('hummytummy.branches.add')}
        </button>
      </form>

      {atLimit ? (
        <p className="text-xs text-amber-700" data-testid="branches-at-limit-hint">
          {t('hummytummy.branches.atLimitHint', {
            defaultValue:
              'Branch limit reached. Upgrade your plan or buy the extra-branch add-on to add more.',
          })}
        </p>
      ) : null}

      {isLoading ? (
        <div className="text-sm text-gray-500">{t('hummytummy.common.loading')}</div>
      ) : (
        <table className="w-full divide-y rounded border text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{t('hummytummy.branches.name')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.branches.code')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.branches.timezone')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.branches.status')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.branches.created')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {branches.map((b) => (
              <tr key={b.id}>
                <td className="px-3 py-2 font-medium">{b.name}</td>
                <td className="px-3 py-2 font-mono">{b.code ?? '—'}</td>
                <td className="px-3 py-2">{b.timezone}</td>
                <td className="px-3 py-2">{b.status}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{new Date(b.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col text-xs text-gray-600">
      {label}
      <input
        className="mt-1 rounded border px-2 py-1 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
