import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Building2,
  Plus,
  Clock3,
  Hash,
  Infinity as InfinityIcon,
  Network,
  ArrowUpRight,
  CheckCircle2,
  Store,
} from 'lucide-react';
import { useCreateBranch, useListBranches, type Branch } from './branchesApi';
import { useGetUsageSnapshot } from '../plan/planApi';
import Card from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Input from '../../components/ui/Input';
import EmptyState from '../../components/ui/EmptyState';

const STATUS_VARIANT: Record<Branch['status'], 'success' | 'warning' | 'default'> = {
  active: 'success',
  suspended: 'warning',
  archived: 'default',
};

export default function BranchesPage() {
  const { t } = useTranslation('common');
  const { data: branches = [], isLoading } = useListBranches();
  const { data: snapshot } = useGetUsageSnapshot();
  const create = useCreateBranch();
  const [draft, setDraft] = useState({ name: '', code: '', timezone: 'Europe/Istanbul' });

  // v3.0.0 — engine-resolved branches usage. -1 = unlimited (BUSINESS / cap
  // override). "At limit" disables the create CTA and points to the add-on.
  const usage = snapshot?.branches;
  const max = usage?.max ?? Number.POSITIVE_INFINITY;
  const current = usage?.current ?? branches.length;
  const isUnlimited = max === -1;
  const atLimit = !isUnlimited && current >= max;
  const activeCount = branches.filter((b) => b.status === 'active').length;
  const pct =
    isUnlimited || !usage || max <= 0
      ? 0
      : Math.min(100, Math.round((current / max) * 100));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
            <Network className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {t('hummytummy.branches.title')}
            </h1>
            <p className="text-sm text-slate-500">
              {t('hummytummy.branches.pageSubtitle', {
                defaultValue:
                  'Restoran zincirinizin tüm şubelerini tek yerden yönetin.',
              })}
            </p>
          </div>
        </div>
        {usage ? (
          <span
            className={
              'inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1.5 text-xs font-medium ' +
              (atLimit
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-700')
            }
            data-testid="branches-usage"
          >
            <Building2 className="h-3.5 w-3.5" />
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

      {/* Overview stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card variant="bordered" className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">
                {t('hummytummy.branches.statTotal', { defaultValue: 'Toplam şube' })}
              </p>
              <p className="text-xl font-semibold text-slate-900">{branches.length}</p>
            </div>
          </div>
        </Card>
        <Card variant="bordered" className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">
                {t('hummytummy.branches.statActive', { defaultValue: 'Aktif şube' })}
              </p>
              <p className="text-xl font-semibold text-slate-900">{activeCount}</p>
            </div>
          </div>
        </Card>
        <Card variant="bordered" className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                {isUnlimited ? (
                  <InfinityIcon className="h-5 w-5" />
                ) : (
                  <Network className="h-5 w-5" />
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500">
                  {t('hummytummy.branches.statCapacity', { defaultValue: 'Kapasite' })}
                </p>
                <p className="text-xl font-semibold text-slate-900">
                  {current}
                  <span className="text-sm font-normal text-slate-400">
                    {' / '}
                    {isUnlimited ? '∞' : max}
                  </span>
                </p>
              </div>
            </div>
          </div>
          {usage && !isUnlimited ? (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={
                  'h-full rounded-full transition-all ' +
                  (atLimit ? 'bg-amber-500' : 'bg-primary-500')
                }
                style={{ width: `${pct}%` }}
              />
            </div>
          ) : null}
        </Card>
      </div>

      {/* At-limit upsell */}
      {atLimit ? (
        <Card
          variant="bordered"
          className="border-amber-200 bg-amber-50 p-4"
          data-testid="branches-at-limit-hint"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <Store className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  {t('hummytummy.branches.atLimitTitle', {
                    defaultValue: 'Şube limitine ulaştınız',
                  })}
                </p>
                <p className="text-sm text-amber-800">
                  {t('hummytummy.branches.atLimitHint', {
                    defaultValue:
                      'Branch limit reached. Upgrade your plan or buy the extra-branch add-on to add more.',
                  })}
                </p>
              </div>
            </div>
            <Link to="/admin/marketplace?focus=extra_branch" className="sm:flex-shrink-0">
              <Button variant="primary" size="sm" className="w-full sm:w-auto">
                {t('hummytummy.branches.goToMarketplace', {
                  defaultValue: 'Pazaryerine git',
                })}
                <ArrowUpRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </Card>
      ) : null}

      {/* Create branch */}
      <Card variant="bordered" className="p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <Plus className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900">
            {t('hummytummy.branches.addTitle', { defaultValue: 'Yeni şube ekle' })}
          </h2>
        </div>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name || atLimit) return;
            create.mutate(draft, {
              onSuccess: () =>
                setDraft({ name: '', code: '', timezone: 'Europe/Istanbul' }),
            });
          }}
        >
          <Input
            label={t('hummytummy.branches.name')}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder={t('hummytummy.branches.namePlaceholder', {
              defaultValue: 'Kadıköy Şubesi',
            })}
          />
          <Input
            label={t('hummytummy.branches.code')}
            value={draft.code}
            onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
            placeholder="IST-01"
          />
          <Input
            label={t('hummytummy.branches.timezone')}
            value={draft.timezone}
            onChange={(e) => setDraft((d) => ({ ...d, timezone: e.target.value }))}
          />
          <Button
            type="submit"
            variant="primary"
            isLoading={create.isPending}
            disabled={create.isPending || atLimit}
            title={
              atLimit
                ? t('hummytummy.branches.atLimitHint', {
                    defaultValue:
                      'Branch limit reached. Upgrade your plan or buy the extra-branch add-on to add more.',
                  })
                : undefined
            }
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t('hummytummy.branches.add')}
          </Button>
        </form>
      </Card>

      {/* Branch list */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} variant="bordered" className="h-28 animate-pulse p-4">
              <div className="h-4 w-1/2 rounded bg-slate-100" />
              <div className="mt-3 h-3 w-1/3 rounded bg-slate-100" />
            </Card>
          ))}
        </div>
      ) : branches.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t('hummytummy.branches.emptyTitle', {
            defaultValue: 'Henüz şube eklenmemiş',
          })}
          description={t('hummytummy.branches.emptyDesc', {
            defaultValue:
              'İlk şubenizi yukarıdaki formdan ekleyin; ardından her şubeyi ayrı ayrı yönetebilirsiniz.',
          })}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => (
            <Card key={b.id} variant="bordered" className="p-4 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <h3 className="truncate font-semibold text-slate-900">{b.name}</h3>
                </div>
                <Badge variant={STATUS_VARIANT[b.status]} size="sm">
                  {t(`hummytummy.branches.statusLabel.${b.status}`, {
                    defaultValue: b.status,
                  })}
                </Badge>
              </div>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-slate-600">
                  <Hash className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                  <span className="font-mono">{b.code ?? '—'}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600">
                  <Clock3 className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                  <span>{b.timezone}</span>
                </div>
              </dl>
              <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400">
                {t('hummytummy.branches.created')}:{' '}
                {new Date(b.createdAt).toLocaleDateString()}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
