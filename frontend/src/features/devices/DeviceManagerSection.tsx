import { useEffect, useState } from 'react';
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
  Server,
  ChevronRight,
  Clock,
} from 'lucide-react';
import {
  useCreateDeviceSlot,
  useListDevices,
  useRetireDevice,
  type DeviceKind,
  type Device,
} from './devicesApi';
import DeviceCommandsDrawer from './DeviceCommandsDrawer';
import { statusPillColor, visibleDevices } from './devicesView';
import Card from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

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

/**
 * Branch-scoped device management — the device table + provisioning extracted
 * from the old flat DevicesPage so it can live INSIDE a branch on the hub. All
 * reads/creates are pinned to `branchId`, so a device always lands in the
 * branch you're managing (no stale X-Branch-Id surprises).
 */
export default function DeviceManagerSection({ branchId }: { branchId: string }) {
  const { t } = useTranslation('common');
  const [includeRetired, setIncludeRetired] = useState(false);
  const [kind, setKind] = useState<DeviceKind>('kds_screen');
  const [openCommandsFor, setOpenCommandsFor] = useState<string | null>(null);

  const { data: devices = [], isLoading } = useListDevices({ branchId });
  const createSlot = useCreateDeviceSlot();
  const retire = useRetireDevice();

  const visible = visibleDevices(devices, includeRetired);
  const live = devices.filter((d) => d.status !== 'retired' && d.status !== 'unprovisioned');
  const onlineCount = live.filter((d) => d.status === 'online').length;
  const pendingCount = devices.filter((d) => d.status === 'unprovisioned').length;

  return (
    <div className="space-y-4">
      {/* Provision row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Server className="h-4 w-4 text-slate-400" />
            {live.length} {t('hummytummy.devices.statTotal', { defaultValue: 'cihaz' })}
          </span>
          <span className="inline-flex items-center gap-1.5 text-emerald-600">
            <Wifi className="h-4 w-4" />
            {onlineCount} {t('hummytummy.devices.statOnline', { defaultValue: 'çevrimiçi' })}
          </span>
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-amber-600">
              <Clock className="h-4 w-4" />
              {pendingCount} {t('hummytummy.devices.pending', { defaultValue: 'eşleşme bekliyor' })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
            value={kind}
            onChange={(e) => setKind(e.target.value as DeviceKind)}
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
            onClick={() => createSlot.mutate({ kind, branchId })}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t('hummytummy.devices.create')}
          </Button>
        </div>
      </div>

      {devices.length > 0 && (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            checked={includeRetired}
            onChange={(e) => setIncludeRetired(e.target.checked)}
          />
          {t('hummytummy.devices.showRetired')}
        </label>
      )}

      {isLoading ? (
        <div className="text-sm text-slate-500">{t('hummytummy.common.loading')}</div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-200 p-8 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Cpu className="h-5 w-5" />
          </div>
          <p className="text-sm text-slate-500">{t('hummytummy.devices.empty')}</p>
        </div>
      ) : (
        <Card variant="bordered" className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] divide-y divide-slate-100 text-sm">
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
                          <span className="text-xs font-medium text-slate-700 group-hover:text-primary-700 group-hover:underline">
                            {t(`hummytummy.devices.kind.${d.kind}`, { defaultValue: d.kind })}
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

/** Live pair-code countdown so the operator knows how long the code is valid. */
function pairCountdown(expiresAt?: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function PairCodeCell({ code, expiresAt }: { code: string; expiresAt?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  // Tick once a second so the countdown counts down live (the device list
  // only refetches every 15s, which would make the timer jump).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const h = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(h);
  }, [expiresAt]);
  const left = pairCountdown(expiresAt);
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
      <div className="flex flex-col">
        <span className="font-mono text-base font-medium tracking-wider text-slate-900">{code}</span>
        {left && <span className="text-xs text-amber-600">{left}</span>}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation('common');
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPillColor(status)}`}
    >
      {t(`hummytummy.devices.statusLabel.${status}`, { defaultValue: status })}
    </span>
  );
}
