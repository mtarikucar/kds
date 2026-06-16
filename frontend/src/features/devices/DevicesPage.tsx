import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-qr-code';
import {
  Cpu,
  Monitor,
  Tablet,
  Printer,
  CreditCard,
  Receipt,
  PhoneCall,
  ScanLine,
  Router,
  Plus,
  Wifi,
  AlertTriangle,
  Server,
  ChevronRight,
} from 'lucide-react';
import { useCreateDeviceSlot, useListDevices, useRetireDevice, type DeviceKind, type Device } from './devicesApi';
import DeviceCommandsDrawer from './DeviceCommandsDrawer';
import { statusPillColor, visibleDevices } from './devicesView';
import Card from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

/**
 * Tenant-facing devices page.
 *
 * Pairing happens on the device itself by typing the code shown in the new
 * row — no separate "pair" UI screen is needed today. Status pill colours map
 * onto the mesh state machine (online/offline/error/busy/maintenance/retired).
 */
const KINDS: DeviceKind[] = [
  'kds_screen', 'tablet_waiter', 'tablet_customer', 'receipt_printer',
  'kitchen_printer', 'pos_terminal', 'yazarkasa', 'caller_id', 'scanner', 'local_bridge',
];

const KIND_ICON: Record<string, typeof Cpu> = {
  kds_screen: Monitor,
  tablet_waiter: Tablet,
  tablet_customer: Tablet,
  receipt_printer: Printer,
  kitchen_printer: Printer,
  pos_terminal: CreditCard,
  yazarkasa: Receipt,
  caller_id: PhoneCall,
  scanner: ScanLine,
  local_bridge: Router,
};

export default function DevicesPage() {
  const { t } = useTranslation('common');
  const [includeRetired, setIncludeRetired] = useState(false);
  const [creating, setCreating] = useState<{ kind: DeviceKind }>({ kind: 'kds_screen' });
  const [openCommandsFor, setOpenCommandsFor] = useState<string | null>(null);

  const { data: devices = [], isLoading } = useListDevices();
  const createSlot = useCreateDeviceSlot();
  const retire = useRetireDevice();

  const visible = visibleDevices(devices, includeRetired);

  // Stats computed on the live (non-retired) fleet.
  const live = devices.filter((d) => d.status !== 'retired');
  const onlineCount = live.filter((d) => d.status === 'online').length;
  const attentionCount = live.filter(
    (d) => d.status === 'error' || d.status === 'offline',
  ).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
            <Cpu className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {t('hummytummy.devices.title')}
            </h1>
            <p className="text-sm text-slate-500">
              {t('hummytummy.devices.pageSubtitle', {
                defaultValue:
                  'Tüm şubelerinizdeki ekran, yazıcı ve terminalleri buradan provizyonlayın ve izleyin.',
              })}
            </p>
          </div>
        </div>
        {/* Provision a new device slot (the single combobox on the page). */}
        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
            value={creating.kind}
            onChange={(e) => setCreating({ kind: e.target.value as DeviceKind })}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`hummytummy.devices.kind.${k}`)}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            disabled={createSlot.isPending}
            onClick={() => createSlot.mutate({ kind: creating.kind })}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t('hummytummy.devices.create')}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card variant="bordered" className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">
                {t('hummytummy.devices.statTotal', { defaultValue: 'Toplam cihaz' })}
              </p>
              <p className="text-xl font-semibold text-slate-900">{live.length}</p>
            </div>
          </div>
        </Card>
        <Card variant="bordered" className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Wifi className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">
                {t('hummytummy.devices.statOnline', { defaultValue: 'Çevrimiçi' })}
              </p>
              <p className="text-xl font-semibold text-slate-900">{onlineCount}</p>
            </div>
          </div>
        </Card>
        <Card variant="bordered" className="p-4">
          <div className="flex items-center gap-3">
            <div
              className={
                'flex h-10 w-10 items-center justify-center rounded-lg ' +
                (attentionCount > 0
                  ? 'bg-red-50 text-red-600'
                  : 'bg-slate-100 text-slate-400')
              }
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">
                {t('hummytummy.devices.statAttention', {
                  defaultValue: 'Dikkat gerekiyor',
                })}
              </p>
              <p className="text-xl font-semibold text-slate-900">{attentionCount}</p>
            </div>
          </div>
        </Card>
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
          checked={includeRetired}
          onChange={(e) => setIncludeRetired(e.target.checked)}
        />
        {t('hummytummy.devices.showRetired')}
      </label>

      {/* Devices */}
      {isLoading ? (
        <div className="text-sm text-slate-500">{t('hummytummy.common.loading')}</div>
      ) : visible.length === 0 ? (
        <Card
          variant="bordered"
          className="flex flex-col items-center gap-2 p-10 text-center"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Cpu className="h-6 w-6" />
          </div>
          <p className="text-sm text-slate-500">{t('hummytummy.devices.empty')}</p>
        </Card>
      ) : (
        <Card variant="bordered" className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('hummytummy.devices.col.kind')}</th>
                  <th className="px-4 py-3 font-medium">{t('hummytummy.devices.col.status')}</th>
                  <th className="px-4 py-3 font-medium">{t('hummytummy.devices.col.pairCode')}</th>
                  <th className="px-4 py-3 font-medium">{t('hummytummy.devices.col.capabilities')}</th>
                  <th className="px-4 py-3 font-medium">{t('hummytummy.devices.col.lastSeen')}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((d: Device) => {
                  const KindIcon = KIND_ICON[d.kind] ?? Cpu;
                  return (
                    <tr key={d.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setOpenCommandsFor(d.id)}
                          title={t('hummytummy.devices.inspectCommands', {
                            defaultValue: 'Cihaz komutlarını görüntüle',
                          })}
                          className="group flex items-center gap-2 text-left"
                        >
                          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                            <KindIcon className="h-4 w-4" />
                          </span>
                          <span className="font-mono text-xs text-primary-700 group-hover:underline">
                            {d.kind}
                          </span>
                          <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-400" />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={d.status} />
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {d.pairCode ? (
                          <PairCodeCell code={d.pairCode} expiresAt={d.pairCodeExpiresAt} />
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {d.capabilities.length === 0 ? '—' : d.capabilities.join(', ')}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => {
                            if (confirm(t('hummytummy.devices.confirmRetire')))
                              retire.mutate(d.id);
                          }}
                        >
                          {t('hummytummy.common.retire')}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {openCommandsFor && (
        <DeviceCommandsDrawer
          deviceId={openCommandsFor}
          onClose={() => setOpenCommandsFor(null)}
        />
      )}
    </div>
  );
}

/**
 * Pair-code cell: the short alphanumeric code + a small QR encoding the same
 * string. Click toggles a larger 192px QR for venue-floor scanning across the
 * room (the small inline QR is hard to scan past ~30cm).
 */
function PairCodeCell({ code, expiresAt }: { code: string; expiresAt?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        className="cursor-pointer rounded-lg border border-slate-200 bg-white p-1.5 transition-shadow hover:shadow-sm"
        onClick={() => setExpanded((v) => !v)}
        title={expiresAt ? `expires ${new Date(expiresAt).toLocaleString()}` : ''}
      >
        <QRCode value={code} size={expanded ? 192 : 52} />
      </button>
      <span className="font-mono text-base font-medium tracking-wider text-slate-900">
        {code}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPillColor(status)}`}
    >
      {status}
    </span>
  );
}
