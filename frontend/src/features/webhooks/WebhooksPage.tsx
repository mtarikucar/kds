import { useState } from 'react';
import { useCreateWebhook, useListWebhooks, useRevokeWebhook, type WebhookSubscription } from './webhooksApi';

/**
 * Tenant page for managing outbound webhook subscriptions.
 *
 * The newly-created subscription's `secret` is rendered ONCE in a banner
 * the user must explicitly dismiss — we don't store it locally either; on
 * navigation it is irretrievable. The dismiss button is the only path out
 * to encourage the user to copy it.
 */
const COMMON_EVENTS = [
  'order.created.v1',
  'order.completed.v1',
  'order.cancelled.v1',
  'payment.intent_created.v1',
  'payment.refund_completed.v1',
  'fiscal.receipt.printed.v1',
  'fiscal.receipt.failed.v1',
  'subscription.activated.v1',
  'subscription.cancelled.v1',
  'addon.purchased.v1',
  'device.command.failed.v1',
];

export default function WebhooksPage() {
  const { data = [], isLoading } = useListWebhooks();
  const create = useCreateWebhook();
  const revoke = useRevokeWebhook();
  const [draft, setDraft] = useState({ url: '', events: ['order.created.v1', 'order.completed.v1'] });
  const [justCreated, setJustCreated] = useState<WebhookSubscription | null>(null);

  function toggleEvent(e: string) {
    setDraft((d) => ({
      ...d,
      events: d.events.includes(e) ? d.events.filter((x) => x !== e) : [...d.events, e],
    }));
  }

  async function submit() {
    if (!draft.url) return;
    const out = await create.mutateAsync(draft);
    setJustCreated(out);
    setDraft({ url: '', events: ['order.created.v1', 'order.completed.v1'] });
  }

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Webhooks</h1>
      <p className="text-sm text-gray-600">
        Subscribe an HTTPS endpoint to HummyTummy events. Deliveries are signed with HMAC-SHA256 +
        timestamp. Auto-paused after 20 consecutive failures.
      </p>

      {justCreated && justCreated.secret && (
        <div className="rounded border border-amber-400 bg-amber-50 p-4">
          <p className="font-medium text-amber-900">Subscription created.</p>
          <p className="mt-1 text-sm text-amber-800">
            Below is the signing secret. <strong>Copy it now — we cannot show it again.</strong>
          </p>
          <pre className="mt-2 rounded bg-white p-2 font-mono text-sm">{justCreated.secret}</pre>
          <button
            className="mt-3 rounded bg-amber-900 px-3 py-1 text-xs text-white"
            onClick={() => setJustCreated(null)}
          >
            I've copied it
          </button>
        </div>
      )}

      <section className="rounded border bg-white p-4">
        <h2 className="text-lg font-medium">New subscription</h2>
        <input
          className="mt-2 w-full rounded border px-3 py-1.5 text-sm font-mono"
          value={draft.url}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          placeholder="https://your-server.example.com/hummytummy-webhook"
        />
        <p className="mt-3 text-xs font-medium text-gray-700">Events:</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {COMMON_EVENTS.map((e) => (
            <button
              key={e}
              onClick={() => toggleEvent(e)}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                draft.events.includes(e) ? 'bg-gray-900 text-white' : 'bg-white hover:bg-gray-50'
              }`}
            >
              {e}
            </button>
          ))}
        </div>
        <button
          className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          disabled={!draft.url || create.isPending}
          onClick={submit}
        >
          Create subscription
        </button>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Your subscriptions</h2>
        {isLoading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : data.length === 0 ? (
          <p className="text-sm text-gray-500">No subscriptions.</p>
        ) : (
          <table className="w-full divide-y rounded border text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">URL</th>
                <th className="px-3 py-2 font-medium">Events</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last delivery</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-mono text-xs">{s.url}</td>
                  <td className="px-3 py-2 text-xs">{s.events.join(', ')}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        s.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {s.status}
                    </span>
                    {s.consecutiveFailures > 0 && (
                      <span className="ml-2 text-xs text-red-700">{s.consecutiveFailures} fail</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {s.lastDeliveryAt ? (
                      <>
                        {new Date(s.lastDeliveryAt).toLocaleString()}
                        {s.lastDeliveryCode != null && <span className="ml-1 text-gray-400">({s.lastDeliveryCode})</span>}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => revoke.mutate(s.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Revoke
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
