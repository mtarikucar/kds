import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Building2,
  Crown,
  Cpu,
  Router,
  Activity,
  Pencil,
  Hash,
  Clock3,
  CreditCard,
  Printer,
  HardDrive,
} from 'lucide-react';
import { useGetBranch, useUpdateBranch } from './branchesApi';
import { useGetHealthOverview } from '../health/healthApi';
import DeviceManagerSection from '../devices/DeviceManagerSection';
import BranchNetworkSection from './BranchNetworkSection';
import { PaymentTerminalsPanel } from '../../pages/settings/PaymentTerminalsSettingsPage';
import { FiscalDevicesPanel } from '../fiscal/FiscalDevicesPanel';
import HardwareDevicesSection from '../devices/HardwareDevicesSection';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { isTauri } from '@/lib/tauri';
import Card from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import { getApiErrorMessage } from '../../lib/api-error';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'default'> = {
  active: 'success',
  suspended: 'warning',
  archived: 'default',
};

const HEALTH_PILL: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/60',
  yellow: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200/60',
  red: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200/60',
};

type Tab = 'devices' | 'terminals' | 'fiscal' | 'hardware' | 'network';

export default function BranchDetailPage() {
  const { t } = useTranslation('common');
  const { id } = useParams<{ id: string }>();
  const { data: branch, isLoading, isError } = useGetBranch(id);
  const { data: health } = useGetHealthOverview();
  const update = useUpdateBranch();
  const activeBranchId = useBranchScopeStore((s) => s.branchId);
  const { hasIntegration } = useSubscription();

  const [tab, setTab] = useState<Tab>('devices');
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', timezone: '' });

  const branchHealth = health?.find((h) => h.id === id)?.health;

  const openEdit = () => {
    if (!branch) return;
    setForm({ name: branch.name, code: branch.code ?? '', timezone: branch.timezone });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!id) return;
    try {
      await update.mutateAsync({
        id,
        // Send the trimmed code even when empty so an existing code can be
        // cleared (|| undefined would silently keep the old value).
        input: { name: form.name.trim(), code: form.code.trim(), timezone: form.timezone.trim() },
      });
      toast.success(t('hummytummy.branchDetail.saved', { defaultValue: 'Şube güncellendi' }));
      setEditOpen(false);
    } catch (e) {
      toast.error(getApiErrorMessage(e, t('hummytummy.branchDetail.saveFailed', { defaultValue: 'Güncellenemedi' })));
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  // Deep-link to a missing branch — or one this user can't access (a
  // branch-restricted MANAGER hitting another branch's /:id 404s server-side).
  // Surface a clear not-found state instead of an infinite skeleton.
  if (isError || !branch) {
    return (
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <Link
          to="/admin/branches"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('hummytummy.branchDetail.back', { defaultValue: 'Şubeler' })}
        </Link>
        <Card variant="bordered" className="flex flex-col items-center gap-3 p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Building2 className="h-6 w-6" />
          </div>
          <p className="text-sm text-slate-500">
            {t('hummytummy.branchDetail.notFound', {
              defaultValue: 'Şube bulunamadı veya erişiminiz yok.',
            })}
          </p>
        </Card>
      </div>
    );
  }

  // Terminal/fiscal/hardware panels write to the ACTIVE scope branch
  // (X-Branch-Id), not necessarily the one this page is showing — an ADMIN
  // roaming through /admin/branches/:id could otherwise register a terminal
  // against the wrong branch. Hide (not 403) those tabs unless this branch
  // IS the active one.
  const isActiveBranch = branch ? activeBranchId === branch.id : false;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Back + header */}
      <div>
        <Link
          to="/admin/branches"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('hummytummy.branchDetail.back', { defaultValue: 'Şubeler' })}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={
                'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ' +
                (branch.isHeadquarters
                  ? 'bg-primary-50 text-primary-600'
                  : 'bg-slate-100 text-slate-600')
              }
            >
              {branch.isHeadquarters ? <Crown className="h-6 w-6" /> : <Building2 className="h-6 w-6" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold text-slate-900">{branch.name}</h1>
                {branch.isHeadquarters && (
                  <Badge variant="primary" size="sm">
                    {t('hummytummy.branchDetail.hq', { defaultValue: 'Merkez' })}
                  </Badge>
                )}
                <Badge variant={STATUS_VARIANT[branch.status] ?? 'default'} size="sm">
                  {t(`hummytummy.branches.statusLabel.${branch.status}`, { defaultValue: branch.status })}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Hash className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-mono">{branch.code ?? '—'}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="h-3.5 w-3.5 text-slate-400" />
                  {branch.timezone}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {branchHealth && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${HEALTH_PILL[branchHealth.pill]}`}
                title={t('hummytummy.branchDetail.healthTitle', { defaultValue: 'Şube sağlık skoru' })}
              >
                <Activity className="h-3.5 w-3.5" />
                {branchHealth.score}
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={openEdit}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              {t('hummytummy.branchDetail.edit', { defaultValue: 'Düzenle' })}
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        <TabButton active={tab === 'devices'} onClick={() => setTab('devices')} icon={Cpu}>
          {t('hummytummy.branchDetail.tabs.devices', { defaultValue: 'Cihazlar' })}
        </TabButton>
        {isActiveBranch && (
          <TabButton active={tab === 'terminals'} onClick={() => setTab('terminals')} icon={CreditCard}>
            {t('hummytummy.branchDetail.tabs.terminals', { defaultValue: 'Ödeme Terminalleri' })}
          </TabButton>
        )}
        {isActiveBranch && hasIntegration('fiscal') && (
          <TabButton active={tab === 'fiscal'} onClick={() => setTab('fiscal')} icon={Printer}>
            {t('hummytummy.branchDetail.tabs.fiscal', { defaultValue: 'Yazarkasa' })}
          </TabButton>
        )}
        {isActiveBranch && isTauri() && (
          <TabButton active={tab === 'hardware'} onClick={() => setTab('hardware')} icon={HardDrive}>
            {t('hummytummy.branchDetail.tabs.hardware', { defaultValue: 'Yazıcı & Çekmece' })}
          </TabButton>
        )}
        <TabButton active={tab === 'network'} onClick={() => setTab('network')} icon={Router}>
          {t('hummytummy.branchDetail.tabs.network', { defaultValue: 'Yerel ağ' })}
        </TabButton>
      </div>

      {!isActiveBranch && (
        <p className="text-xs text-slate-500">
          {t('hummytummy.branchDetail.scopeHint', {
            defaultValue: 'Terminal ve yazarkasa yönetimi için üst çubuktan bu şubeye geçin.',
          })}
        </p>
      )}

      <Card variant="bordered" className="p-4 sm:p-5">
        {tab === 'devices' && <DeviceManagerSection branchId={branch.id} />}
        {tab === 'terminals' && <PaymentTerminalsPanel />}
        {tab === 'fiscal' && <FiscalDevicesPanel />}
        {tab === 'hardware' && <HardwareDevicesSection />}
        {tab === 'network' && <BranchNetworkSection branchId={branch.id} />}
      </Card>

      <Modal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title={t('hummytummy.branchDetail.editTitle', { defaultValue: 'Şubeyi düzenle' })}
        size="sm"
      >
        <div className="space-y-4">
          <Input
            label={t('hummytummy.branches.name')}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label={t('hummytummy.branches.code')}
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            placeholder="IST-01"
          />
          <Input
            label={t('hummytummy.branches.timezone')}
            value={form.timezone}
            onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              {t('hummytummy.common.cancel', { defaultValue: 'Vazgeç' })}
            </Button>
            <Button onClick={saveEdit} isLoading={update.isPending} disabled={!form.name.trim()}>
              {t('hummytummy.common.save', { defaultValue: 'Kaydet' })}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Cpu;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ' +
        (active
          ? 'border-primary-500 text-primary-700'
          : 'border-transparent text-slate-500 hover:text-slate-700')
      }
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  );
}
