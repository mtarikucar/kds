import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Building2,
  Plus,
  Hash,
  Infinity as InfinityIcon,
  Network,
  ArrowUpRight,
  CheckCircle2,
  Store,
  Crown,
  Cpu,
  Router,
  Wifi,
  Clock,
  ChevronRight,
} from 'lucide-react';
import { useCreateBranch, useBranchOverview } from './branchesApi';
import { useGetUsageSnapshot } from '../plan/planApi';
import Card from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Input from '../../components/ui/Input';
import EmptyState from '../../components/ui/EmptyState';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'default'> = {
  active: 'success',
  suspended: 'warning',
  archived: 'default',
};

export default function BranchesPage() {
  const { t } = useTranslation('common');
  const { data: branches = [], isLoading } = useBranchOverview();
  const { data: snapshot } = useGetUsageSnapshot();
  const create = useCreateBranch();
  const [draft, setDraft] = useState({ name: '', code: '', timezone: 'Europe/Istanbul' });

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
              {t('hummytummy.branches.hubSubtitle', {
                defaultValue:
                  'Her şubeyi açıp cihazlarını ve yerel ağını (köprü) tek yerden yönetin.',
              })}
            </p>
          </div>
        </div>
        {usage ? (
          <span
            className={
              'inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1.5 text-xs font-medium ' +
              (atLimit ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700')
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
        <StatCard
          icon={Building2}
          tone="slate"
          label={t('hummytummy.branches.statTotal', { defaultValue: 'Toplam şube' })}
          value={branches.length}
        />
        <StatCard
          icon={CheckCircle2}
          tone="emerald"
          label={t('hummytummy.branches.statActive', { defaultValue: 'Aktif şube' })}
          value={activeCount}
        />
        <Card variant="bordered" className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              {isUnlimited ? <InfinityIcon className="h-5 w-5" /> : <Network className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500">
                {t('hummytummy.branches.statCapacity', { defaultValue: 'Kapasite' })}
              </p>
              <p className="text-xl font-semibold text-slate-900">
                {current}
                <span className="text-sm font-normal text-slate-400">{' / '}{isUnlimited ? '∞' : max}</span>
              </p>
            </div>
          </div>
          {usage && !isUnlimited ? (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={'h-full rounded-full transition-all ' + (atLimit ? 'bg-amber-500' : 'bg-primary-500')}
                style={{ width: `${pct}%` }}
              />
            </div>
          ) : null}
        </Card>
      </div>

      {/* At-limit upsell */}
      {atLimit ? (
        <Card variant="bordered" className="border-amber-200 bg-amber-50 p-4" data-testid="branches-at-limit-hint">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <Store className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  {t('hummytummy.branches.atLimitTitle', { defaultValue: 'Şube limitine ulaştınız' })}
                </p>
                <p className="text-sm text-amber-800">
                  {t('hummytummy.branches.atLimitHint', {
                    defaultValue:
                      'Branch limit reached. Upgrade your plan or buy the extra-branch add-on to add more.',
                  })}
                </p>
              </div>
            </div>
            <Link to="/admin/store?tab=addons&focus=extra_branch" className="sm:flex-shrink-0">
              <Button variant="primary" size="sm" className="w-full sm:w-auto">
                {t('hummytummy.branches.goToMarketplace', { defaultValue: 'Pazaryerine git' })}
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
              onSuccess: () => setDraft({ name: '', code: '', timezone: 'Europe/Istanbul' }),
            });
          }}
        >
          <Input
            label={t('hummytummy.branches.name')}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder={t('hummytummy.branches.namePlaceholder', { defaultValue: 'Kadıköy Şubesi' })}
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

      {/* Branch cards → drill into device + network management */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} variant="bordered" className="h-36 animate-pulse p-4">
              <div className="h-4 w-1/2 rounded bg-slate-100" />
              <div className="mt-3 h-3 w-1/3 rounded bg-slate-100" />
            </Card>
          ))}
        </div>
      ) : branches.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t('hummytummy.branches.emptyTitle', { defaultValue: 'Henüz şube eklenmemiş' })}
          description={t('hummytummy.branches.emptyDesc', {
            defaultValue:
              'İlk şubenizi yukarıdaki formdan ekleyin; ardından her şubeyi ayrı ayrı yönetebilirsiniz.',
          })}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => (
            <Link
              key={b.id}
              to={`/admin/branches/${b.id}`}
              className="group block focus:outline-none"
            >
              <Card variant="bordered" className="p-4 transition-shadow group-hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div
                      className={
                        'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ' +
                        (b.isHeadquarters ? 'bg-primary-50 text-primary-600' : 'bg-slate-100 text-slate-600')
                      }
                    >
                      {b.isHeadquarters ? <Crown className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-1.5 truncate font-semibold text-slate-900">
                        {b.name}
                      </h3>
                      <span className="font-mono text-xs text-slate-400">{b.code ?? '—'}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {b.isHeadquarters && (
                      <Badge variant="primary" size="sm">
                        {t('hummytummy.branchDetail.hq', { defaultValue: 'Merkez' })}
                      </Badge>
                    )}
                    <Badge variant={STATUS_VARIANT[b.status] ?? 'default'} size="sm">
                      {t(`hummytummy.branches.statusLabel.${b.status}`, { defaultValue: b.status })}
                    </Badge>
                  </div>
                </div>

                {/* Device + network tallies */}
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <Cpu className="h-4 w-4 text-slate-400" />
                    {b.devices.total}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-emerald-600">
                    <Wifi className="h-4 w-4" />
                    {b.devices.online}
                  </span>
                  {b.devices.pending > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-amber-600">
                      <Clock className="h-4 w-4" />
                      {b.devices.pending}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <Router className="h-4 w-4 text-slate-400" />
                    {b.bridges}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Hash className="h-3 w-3" />
                    {b.timezone}
                  </span>
                  <span className="inline-flex items-center gap-0.5 font-medium text-primary-600 group-hover:gap-1.5">
                    {t('hummytummy.branches.manage', { defaultValue: 'Yönet' })}
                    <ChevronRight className="h-3.5 w-3.5 transition-all" />
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: typeof Building2;
  tone: 'slate' | 'emerald';
  label: string;
  value: number;
}) {
  const toneCls = tone === 'emerald' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-600';
  return (
    <Card variant="bordered" className="p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneCls}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="text-xl font-semibold text-slate-900">{value}</p>
        </div>
      </div>
    </Card>
  );
}
