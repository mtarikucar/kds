import { useState } from 'react';
import { useEnqueueCommand, useListDeviceCommands, type DeviceCommand } from './devicesApi';

/**
 * Per-device command inspector. Slides in from the right when an admin
 * clicks a device row. Used during ops to:
 *   - confirm the queue isn't backed up,
 *   - re-enqueue a one-off `capability_probe` if the device looks unhealthy,
 *   - read the last failure reason on a `failed` row.
 *
 * Filter chips correspond to the four canonical statuses: queued, inflight,
 * done, failed. "All" omits the filter.
 */
const FILTERS: { label: string; value?: string }[] = [
  { label: 'All' },
  { label: 'Queued', value: 'queued' },
  { label: 'In-flight', value: 'inflight' },
  { label: 'Done', value: 'done' },
  { label: 'Failed', value: 'failed' },
];

interface Props {
  deviceId: string;
  onClose: () => void;
}

export default function DeviceCommandsDrawer({ deviceId, onClose }: Props) {
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const { data: commands = [], isLoading, refetch } = useListDeviceCommands(deviceId, filter);
  const enqueue = useEnqueueCommand(deviceId);

  function probe() {
    enqueue.mutate(
      { kind: 'capability_probe', payload: { target: 'self' }, priority: 9 },
      { onSuccess: () => refetch() },
    );
  }

  return (
    <aside className="fixed right-0 top-0 z-50 h-screen w-full max-w-xl overflow-y-auto border-l bg-white shadow-xl">
      <header className="flex items-center justify-between border-b p-4">
        <div>
          <h2 className="text-lg font-semibold">Device commands</h2>
          <p className="text-xs text-gray-500 font-mono">{deviceId}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={probe}
            className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
            disabled={enqueue.isPending}
          >
            Send probe
          </button>
          <button onClick={onClose} aria-label="Close" className="rounded p-2 hover:bg-gray-100">
            ✕
          </button>
        </div>
      </header>

      <div className="flex gap-1 p-3">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3 py-1 text-xs ${
              filter === f.value ? 'bg-gray-900 text-white' : 'border bg-white hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="p-4 text-sm text-gray-500">Loading…</div>
      ) : commands.length === 0 ? (
        <div className="p-4 text-sm text-gray-500">No commands in this view.</div>
      ) : (
        <ul className="divide-y">
          {commands.map((c: DeviceCommand) => (
            <li key={c.id} className="p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono text-xs text-gray-500">{c.id}</div>
                  <div className="font-medium">{c.kind}</div>
                </div>
                <StatusChip status={c.status} attempts={c.attempts} />
              </div>
              {c.error && (
                <p className="mt-1 rounded bg-red-50 p-2 text-xs text-red-700">{c.error}</p>
              )}
              {c.result && (
                <pre className="mt-1 rounded bg-gray-50 p-2 text-xs">
                  {JSON.stringify(c.result, null, 2).slice(0, 400)}
                </pre>
              )}
              <p className="mt-1 text-xs text-gray-500">
                {new Date(c.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function StatusChip({ status, attempts }: { status: string; attempts: number }) {
  const colors: Record<string, string> = {
    queued: 'bg-blue-100 text-blue-800',
    inflight: 'bg-amber-100 text-amber-800',
    done: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    expired: 'bg-gray-200 text-gray-700',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status}
      {attempts > 1 && <span className="opacity-60">×{attempts}</span>}
    </span>
  );
}
