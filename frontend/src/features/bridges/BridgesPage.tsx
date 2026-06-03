import { useState } from 'react';
import { useListBranches } from '../branches/branchesApi';
import { useCreateBridge, useListBridges, useRetireBridge, type LocalBridge } from './bridgesApi';

/**
 * Local Bridge management. Two operational paths:
 *   1. Provision a new bridge — server emits a single-use provisioning
 *      token that the operator enters on the HummyBox at first boot.
 *   2. Inspect existing bridges + their heartbeat status.
 *
 * Provisioning token is shown ONCE in a dismissable banner. Re-fetching the
 * row never returns it; the operator must capture it on creation.
 */
export default function BridgesPage() {
  const { data: branches = [] } = useListBranches();
  const { data: bridges = [], isLoading } = useListBridges();
  const create = useCreateBridge();
  const retire = useRetireBridge();
  const [draft, setDraft] = useState({ branchId: '', productSku: 'hummybox-lite', hostname: '' });
  const [justCreated, setJustCreated] = useState<LocalBridge | null>(null);

  async function submit() {
    if (!draft.branchId) return;
    const out = await create.mutateAsync(draft);
    setJustCreated(out);
    setDraft({ branchId: '', productSku: 'hummybox-lite', hostname: '' });
  }

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Local Bridges</h1>

      {justCreated?.provisioningToken && (
        <div className="rounded border border-amber-400 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">Bridge provisioned.</p>
          <p className="mt-1 text-sm text-amber-800">
            Token (single-use) — copy now and configure on the device:
          </p>
          <pre className="mt-2 rounded bg-white p-2 font-mono text-sm break-all">
            {justCreated.provisioningToken}
          </pre>
          <button
            className="mt-3 rounded bg-amber-900 px-3 py-1 text-xs text-white"
            onClick={() => setJustCreated(null)}
          >
            I've copied it
          </button>
        </div>
      )}

      <section className="rounded border bg-white p-4">
        <h2 className="text-lg font-medium">New bridge</h2>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-gray-600">
            Branch
            <select
              className="mt-1 rounded border px-2 py-1 text-sm"
              value={draft.branchId}
              onChange={(e) => setDraft((d) => ({ ...d, branchId: e.target.value }))}
            >
              <option value="">— select —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-gray-600">
            SKU
            <select
              className="mt-1 rounded border px-2 py-1 text-sm"
              value={draft.productSku}
              onChange={(e) => setDraft((d) => ({ ...d, productSku: e.target.value }))}
            >
              <option value="hummybox-lite">HummyBox Lite</option>
              <option value="hummybox-pro">HummyBox Pro</option>
              <option value="">BYO</option>
            </select>
          </label>
          <label className="flex flex-col text-xs text-gray-600">
            Hostname (optional)
            <input
              className="mt-1 rounded border px-2 py-1 text-sm"
              value={draft.hostname}
              onChange={(e) => setDraft((d) => ({ ...d, hostname: e.target.value }))}
            />
          </label>
          <button
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={!draft.branchId || create.isPending}
            onClick={submit}
          >
            Provision
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Bridges</h2>
        {isLoading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : bridges.length === 0 ? (
          <p className="text-sm text-gray-500">No bridges provisioned yet.</p>
        ) : (
          <table className="w-full divide-y rounded border text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">Hostname</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last seen</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bridges.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2">{branches.find((br) => br.id === b.branchId)?.name ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{b.productSku ?? 'byo'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{b.hostname ?? '—'}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={b.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {b.lastSeenAt ? new Date(b.lastSeenAt).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => {
                        if (confirm('Retire this bridge?')) retire.mutate(b.id);
                      }}
                    >
                      Retire
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: 'bg-green-100 text-green-800',
    offline: 'bg-gray-100 text-gray-700',
    claiming: 'bg-purple-100 text-purple-800',
    retired: 'bg-gray-200 text-gray-500',
  };
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}
