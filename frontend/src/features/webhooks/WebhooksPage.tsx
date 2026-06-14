import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
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
  const { t } = useTranslation('webhooks');
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
      <h1 className="text-2xl font-semibold">{t('page.title')}</h1>
      <p className="text-sm text-gray-600">{t('page.intro')}</p>

      {justCreated && justCreated.secret && (
        <SecretReveal secret={justCreated.secret} onDismiss={() => setJustCreated(null)} />
      )}

      <section className="rounded border bg-white p-4">
        <h2 className="text-lg font-medium">{t('create.title')}</h2>
        <input
          className="mt-2 w-full rounded border px-3 py-1.5 text-sm font-mono"
          value={draft.url}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          placeholder={t('create.urlPlaceholder')}
        />
        <p className="mt-3 text-xs font-medium text-gray-700">{t('create.eventsLabel')}</p>
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
          {t('create.submit')}
        </button>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">{t('list.title')}</h2>
        {isLoading ? (
          <div className="text-sm text-gray-500">{t('list.loading')}</div>
        ) : data.length === 0 ? (
          <p className="text-sm text-gray-500">{t('list.empty')}</p>
        ) : (
          <table className="w-full divide-y rounded border text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t('list.col.url')}</th>
                <th className="px-3 py-2 font-medium">{t('list.col.events')}</th>
                <th className="px-3 py-2 font-medium">{t('list.col.status')}</th>
                <th className="px-3 py-2 font-medium">{t('list.col.lastDelivery')}</th>
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
                      {t(`status.${s.status}`, s.status)}
                    </span>
                    {s.consecutiveFailures > 0 && (
                      <span className="ml-2 text-xs text-red-700">
                        {t('list.failCount', { count: s.consecutiveFailures })}
                      </span>
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
                      {t('list.revoke')}
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

/**
 * One-time secret reveal.
 *
 * Behavior:
 *  - Pre-copies the secret to the clipboard on mount so the user can
 *    paste it without selecting text (which would leak to mouse-tracker
 *    extensions / accessibility tools).
 *  - Renders the secret masked behind a "Show" toggle so screen-shares
 *    and walk-bys don't capture it inadvertently.
 *  - Auto-dismisses after 90 seconds — operators that wander off don't
 *    leave a credential sitting on the screen.
 */
function SecretReveal({ secret, onDismiss }: { secret: string; onDismiss: () => void }) {
  const { t } = useTranslation('webhooks');
  const [shown, setShown] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(90);

  useEffect(() => {
    // Best-effort clipboard prime. Clipboard API requires a secure context
    // (HTTPS); in dev over plain HTTP this throws and we just skip.
    navigator.clipboard
      ?.writeText(secret)
      .then(() => toast.success(t('secret.toastCopied')))
      .catch(() => undefined);
  }, [secret, t]);

  // `onDismiss` is a fresh inline function on every parent render, which
  // would re-fire this effect each time and stack timers. Pin the latest
  // version in a ref and reference that inside the interval so the deps
  // can stay empty.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          onDismissRef.current();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <div className="rounded border border-amber-400 bg-amber-50 p-4">
      <p className="font-medium text-amber-900">{t('secret.created')}</p>
      <p className="mt-1 text-sm text-amber-800">
        {t('secret.copiedIntro')} <strong>{t('secret.saveNow')}</strong>{' '}
        {t('secret.autoHiding', { seconds: secondsLeft })}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code
          className="flex-1 rounded bg-white p-2 font-mono text-sm select-all"
          style={shown ? undefined : { filter: 'blur(6px)', userSelect: 'none' }}
        >
          {secret}
        </code>
        <button
          className="rounded border bg-white px-3 py-1 text-xs"
          onClick={() => setShown((v) => !v)}
        >
          {shown ? t('secret.hide') : t('secret.show')}
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          className="rounded border bg-white px-3 py-1 text-xs"
          onClick={() => {
            navigator.clipboard?.writeText(secret).then(() => toast.success(t('secret.toastCopiedShort')));
          }}
        >
          {t('secret.copyAgain')}
        </button>
        <button
          className="rounded bg-amber-900 px-3 py-1 text-xs text-white"
          onClick={onDismiss}
        >
          {t('secret.saved')}
        </button>
      </div>
    </div>
  );
}
