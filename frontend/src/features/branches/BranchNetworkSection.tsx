import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Router, Cloud, Plus, Cpu, Wifi } from 'lucide-react';
import { useBranchNetwork } from './branchesApi';
import {
  useCreateBridge,
  useRetireBridge,
  type LocalBridge,
} from '../bridges/bridgesApi';
import { statusPillColor } from '../devices/devicesView';
import Card from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

/**
 * A branch's local-network topology ("şube içi ağ"): each on-prem bridge with
 * the devices behind it, plus the cloud-direct devices (no bridge). The bridge
 * is what relays commands to local hardware (printers, yazarkasa, card
 * terminals); cloud-direct devices (tablets, KDS screens) talk to the cloud
 * straight. Operators provision a bridge here, scoped to this branch.
 */
export default function BranchNetworkSection({ branchId }: { branchId: string }) {
  const { t } = useTranslation('common');
  const { data: net, isLoading } = useBranchNetwork(branchId);
  const create = useCreateBridge();
  const retire = useRetireBridge();
  const [sku, setSku] = useState('hummybox-lite');
  const [hostname, setHostname] = useState('');
  const [justCreated, setJustCreated] = useState<LocalBridge | null>(null);

  async function provision() {
    try {
      const out = await create.mutateAsync({ branchId, productSku: sku, hostname });
      setJustCreated(out);
      setHostname('');
    } catch {
      // useCreateBridge already toasts the error; swallow so the awaited
      // rejection isn't unhandled.
    }
  }

  return (
    <div className="space-y-4">
      {/* One-time provisioning token banner */}
      {justCreated?.provisioningToken && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            {t('hummytummy.network.tokenTitle', { defaultValue: 'Köprü token’ı (bir kez gösterilir)' })}
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {t('hummytummy.network.tokenIntro', {
              defaultValue: 'Bu token’ı HummyBox’a ilk açılışta girin. Sayfayı kapatınca tekrar gösterilmez.',
            })}
          </p>
          <pre className="mt-2 break-all rounded bg-white p-2 font-mono text-xs">
            {justCreated.provisioningToken}
          </pre>
          <button
            className="mt-3 rounded bg-amber-900 px-3 py-1 text-xs text-white"
            onClick={() => setJustCreated(null)}
          >
            {t('hummytummy.network.tokenCopied', { defaultValue: 'Kopyaladım' })}
          </button>
        </div>
      )}

      {/* Provision a bridge */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <label className="flex flex-col text-xs text-slate-600">
          {t('hummytummy.network.sku', { defaultValue: 'Donanım' })}
          <select
            className="mt-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
          >
            <option value="hummybox-lite">HummyBox Lite</option>
            <option value="hummybox-pro">HummyBox Pro</option>
            <option value="">{t('hummytummy.network.byo', { defaultValue: 'Kendi donanımım' })}</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          {t('hummytummy.network.hostname', { defaultValue: 'Ana bilgisayar adı' })}
          <input
            className="mt-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="kds-bridge-01"
          />
        </label>
        <Button variant="primary" disabled={create.isPending} onClick={provision}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t('hummytummy.network.addBridge', { defaultValue: 'Köprü ekle' })}
        </Button>
      </div>

      {isLoading || !net ? (
        <div className="text-sm text-slate-500">{t('hummytummy.common.loading')}</div>
      ) : net.bridges.length === 0 && net.cloudDirect.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-200 p-8 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Router className="h-5 w-5" />
          </div>
          <p className="text-sm text-slate-500">
            {t('hummytummy.network.empty', {
              defaultValue: 'Bu şubede henüz köprü ya da cihaz yok.',
            })}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {net.bridges.map((br) => (
            <Card key={br.id} variant="bordered" className="overflow-hidden p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                    <Router className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {br.hostname || (br.productSku || 'byo')}
                    </p>
                    <p className="text-xs text-slate-500">{br.productSku || 'byo'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <NetPill status={br.status} />
                  <button
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => {
                      if (confirm(t('hummytummy.network.retireBridgeConfirm', { defaultValue: 'Köprü kaldırılsın mı?' })))
                        retire.mutate(br.id);
                    }}
                  >
                    {t('hummytummy.common.retire')}
                  </button>
                </div>
              </div>
              <DeviceRows devices={br.devices} emptyKey="hummytummy.network.noDevicesBehind" />
            </Card>
          ))}

          {/* Cloud-direct devices (no bridge) */}
          <Card variant="bordered" className="overflow-hidden p-0">
            <div className="flex items-center gap-2.5 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                <Cloud className="h-4 w-4" />
              </span>
              <p className="text-sm font-medium text-slate-900">
                {t('hummytummy.network.cloudDirect', { defaultValue: 'Buluta doğrudan bağlı' })}
              </p>
            </div>
            <DeviceRows devices={net.cloudDirect} emptyKey="hummytummy.network.noCloudDirect" />
          </Card>
        </div>
      )}
    </div>
  );
}

function DeviceRows({
  devices,
  emptyKey,
}: {
  devices: { id: string; kind: string; status: string; serial: string | null }[];
  emptyKey: string;
}) {
  const { t } = useTranslation('common');
  if (devices.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-slate-400">
        {t(emptyKey, { defaultValue: '—' })}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {devices.map((d) => (
        <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2 text-slate-700">
            <Cpu className="h-4 w-4 text-slate-400" />
            {t(`hummytummy.devices.kind.${d.kind}`, { defaultValue: d.kind })}
            {d.serial && <span className="font-mono text-xs text-slate-400">· {d.serial}</span>}
          </span>
          <NetPill status={d.status} />
        </li>
      ))}
    </ul>
  );
}

function NetPill({ status }: { status: string }) {
  const { t } = useTranslation('common');
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPillColor(status)}`}
    >
      {status === 'online' && <Wifi className="h-3 w-3" />}
      {t(`hummytummy.devices.statusLabel.${status}`, { defaultValue: status })}
    </span>
  );
}
