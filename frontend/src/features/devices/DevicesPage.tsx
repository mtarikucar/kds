import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-qr-code';
import { useCreateDeviceSlot, useListDevices, useRetireDevice, type DeviceKind, type Device } from './devicesApi';
import DeviceCommandsDrawer from './DeviceCommandsDrawer';
import { statusPillColor, visibleDevices } from './devicesView';

/**
 * Tenant-facing devices page.
 *
 * One table, one "Create slot" button. Pairing happens on the device itself
 * by typing in the code shown in the new row — no separate "pair" UI screen
 * is needed today.
 *
 * Status pill colours map onto the mesh state machine:
 *   online      green
 *   offline     gray
 *   error       red
 *   busy        amber
 *   maintenance blue
 *   retired     hidden by default
 */
const KINDS: DeviceKind[] = [
  'kds_screen', 'tablet_waiter', 'tablet_customer', 'receipt_printer',
  'kitchen_printer', 'pos_terminal', 'yazarkasa', 'caller_id', 'scanner', 'local_bridge',
];

export default function DevicesPage() {
  const { t } = useTranslation('common');
  const [includeRetired, setIncludeRetired] = useState(false);
  const [creating, setCreating] = useState<{ kind: DeviceKind }>({ kind: 'kds_screen' });
  const [openCommandsFor, setOpenCommandsFor] = useState<string | null>(null);

  const { data: devices = [], isLoading } = useListDevices();
  const createSlot = useCreateDeviceSlot();
  const retire = useRetireDevice();

  const visible = visibleDevices(devices, includeRetired);

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('hummytummy.devices.title')}</h1>
        <div className="flex items-center gap-2">
          <select
            className="rounded border px-2 py-1 text-sm"
            value={creating.kind}
            onChange={(e) => setCreating({ kind: e.target.value as DeviceKind })}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`hummytummy.devices.kind.${k}`)}
              </option>
            ))}
          </select>
          <button
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={createSlot.isPending}
            onClick={() => createSlot.mutate({ kind: creating.kind })}
          >
            {t('hummytummy.devices.create')}
          </button>
        </div>
      </header>

      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={includeRetired} onChange={(e) => setIncludeRetired(e.target.checked)} />
        {t('hummytummy.devices.showRetired')}
      </label>

      {isLoading ? (
        <div className="text-sm text-gray-500">{t('hummytummy.common.loading')}</div>
      ) : visible.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
          {t('hummytummy.devices.empty')}
        </div>
      ) : (
        <table className="w-full divide-y rounded border text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t('hummytummy.devices.col.kind')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('hummytummy.devices.col.status')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('hummytummy.devices.col.pairCode')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('hummytummy.devices.col.capabilities')}</th>
              <th className="px-3 py-2 text-left font-medium">{t('hummytummy.devices.col.lastSeen')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.map((d: Device) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td
                  className="px-3 py-2 font-mono text-xs cursor-pointer text-blue-700 hover:underline"
                  onClick={() => setOpenCommandsFor(d.id)}
                  title="Inspect device commands"
                >
                  {d.kind}
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={d.status} />
                </td>
                <td className="px-3 py-2 font-mono">
                  {d.pairCode ? (
                    <PairCodeCell code={d.pairCode} expiresAt={d.pairCodeExpiresAt} />
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {d.capabilities.length === 0 ? '—' : d.capabilities.join(', ')}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => {
                      if (confirm(t('hummytummy.devices.confirmRetire'))) retire.mutate(d.id);
                    }}
                  >
                    {t('hummytummy.common.retire')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
 * Pair-code cell: prints the short alphanumeric code and a 96px QR that
 * encodes the same string. The device's pairing screen scans the QR (when
 * its camera/scanner permits) or accepts a typed code as fallback.
 *
 * Click toggles a larger 192px QR for venue-floor scanning across the room
 * (the small inline QR is hard to scan past ~30cm). State is local to the
 * cell so multiple device rows can expand independently.
 */
function PairCodeCell({ code, expiresAt }: { code: string; expiresAt?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <div
        className="cursor-pointer rounded bg-white p-1"
        onClick={() => setExpanded((v) => !v)}
        title={expiresAt ? `expires ${new Date(expiresAt).toLocaleString()}` : ''}
      >
        <QRCode value={code} size={expanded ? 192 : 56} />
      </div>
      <span className="font-mono text-base">{code}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${statusPillColor(status)}`}>
      {status}
    </span>
  );
}
