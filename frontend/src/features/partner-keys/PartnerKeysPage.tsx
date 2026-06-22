import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { KeyRound, Plus } from 'lucide-react';
import {
  PARTNER_KEY_SCOPES,
  useCreatePartnerKey,
  useListPartnerKeys,
  useRevokePartnerKey,
  type PartnerApiKey,
  type PartnerKeyScope,
} from './partnerKeysApi';
import { useListBranches } from '../branches/branchesApi';
import Card from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';

/**
 * Tenant-facing Partner Display API key management.
 *
 * Issues tenant-scoped API keys that let a partner's app/screen (a table
 * tablet) do what the QR-code menu does — browse menu, order, self-pay and
 * watch order status live — via an HMAC-signed machine auth flow.
 *
 * The page is gated server-side by `PlanFeatureGuard` + the `externalDisplay`
 * feature; this component is also wrapped in a page-root `<FeatureGate>` in
 * App.tsx so a tenant lacking the feature sees an upsell instead of a 403.
 *
 * The freshly-issued `secret` is rendered ONCE in a dismissable banner — it is
 * never stored locally and is irretrievable after navigation.
 */
export default function PartnerKeysPage() {
  const { t } = useTranslation('partnerKeys');
  const { data: keys = [], isLoading } = useListPartnerKeys();
  const revoke = useRevokePartnerKey();

  const [createOpen, setCreateOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<PartnerApiKey | null>(null);

  const visible = keys; // backend already excludes nothing sensitive; show all

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
            <KeyRound className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{t('page.title')}</h1>
            <p className="text-sm text-slate-500">{t('page.subtitle')}</p>
          </div>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t('create.button')}
        </Button>
      </div>

      {justCreated && justCreated.secret && (
        <SecretReveal
          keyId={justCreated.keyId}
          secret={justCreated.secret}
          onDismiss={() => setJustCreated(null)}
        />
      )}

      {/* Keys */}
      {isLoading ? (
        <div className="text-sm text-slate-500">{t('list.loading')}</div>
      ) : visible.length === 0 ? (
        <Card variant="bordered" className="flex flex-col items-center gap-2 p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <KeyRound className="h-6 w-6" />
          </div>
          <p className="text-sm text-slate-500">{t('list.empty')}</p>
        </Card>
      ) : (
        <Card variant="bordered" className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('list.col.name')}</th>
                  <th className="px-4 py-3 font-medium">{t('list.col.keyId')}</th>
                  <th className="px-4 py-3 font-medium">{t('list.col.scopes')}</th>
                  <th className="px-4 py-3 font-medium">{t('list.col.status')}</th>
                  <th className="px-4 py-3 font-medium">{t('list.col.lastUsed')}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((k: PartnerApiKey) => (
                  <tr key={k.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-medium text-slate-900">{k.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{k.keyId}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          k.scopes.map((s) => (
                            <span
                              key={s}
                              className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600"
                            >
                              {s}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={k.status} label={t(`status.${k.status}`, k.status)} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {k.status === 'active' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          disabled={revoke.isPending}
                          onClick={() => {
                            if (confirm(t('list.confirmRevoke', { name: k.name }))) {
                              revoke.mutate(k.id);
                            }
                          }}
                        >
                          {t('list.revoke')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CreateKeyModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(row) => {
          setCreateOpen(false);
          setJustCreated(row);
        }}
      />
    </div>
  );
}

const ALL_SCOPES: PartnerKeyScope[] = [...PARTNER_KEY_SCOPES];

function CreateKeyModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (row: PartnerApiKey) => void;
}) {
  const { t } = useTranslation('partnerKeys');
  const create = useCreatePartnerKey();
  const { data: branches = [] } = useListBranches();

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<PartnerKeyScope[]>([...ALL_SCOPES]);
  const [origins, setOrigins] = useState('');
  const [restrictBranches, setRestrictBranches] = useState(false);
  const [branchIds, setBranchIds] = useState<string[]>([]);

  // Reset the draft whenever the modal is (re)opened.
  useEffect(() => {
    if (isOpen) {
      setName('');
      setScopes([...ALL_SCOPES]);
      setOrigins('');
      setRestrictBranches(false);
      setBranchIds([]);
    }
  }, [isOpen]);

  function toggleScope(s: PartnerKeyScope) {
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  function toggleBranch(id: string) {
    setBranchIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const allowedReturnOrigins = origins
      .split(/[\n,]/)
      .map((o) => o.trim())
      .filter(Boolean);
    try {
      const row = await create.mutateAsync({
        name: trimmed,
        scopes,
        allowedReturnOrigins,
        allowedBranchIds: restrictBranches ? branchIds : [],
      });
      onCreated(row);
    } catch {
      // toast handled by the mutation's onError; keep the modal open to retry.
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('create.title')} size="lg">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            {t('create.nameLabel')}
          </label>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('create.namePlaceholder')}
          />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">{t('create.scopesLabel')}</p>
          <div className="flex flex-wrap gap-1.5">
            {ALL_SCOPES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleScope(s)}
                className={`rounded-full border px-2.5 py-1 font-mono text-xs transition-colors ${
                  scopes.includes(s)
                    ? 'border-primary-500 bg-primary-500 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            {t('create.originsLabel')}
          </label>
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
            rows={2}
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
            placeholder={t('create.originsPlaceholder')}
          />
          <p className="mt-1 text-xs text-slate-400">{t('create.originsHint')}</p>
        </div>

        <div>
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              checked={restrictBranches}
              onChange={(e) => setRestrictBranches(e.target.checked)}
            />
            {t('create.restrictBranchesLabel')}
          </label>
          {restrictBranches && (
            <div className="mt-2 space-y-1.5 rounded-lg border border-slate-200 p-3">
              {branches.length === 0 ? (
                <p className="text-xs text-slate-400">{t('create.noBranches')}</p>
              ) : (
                branches.map((b) => (
                  <label
                    key={b.id}
                    className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                      checked={branchIds.includes(b.id)}
                      onChange={() => toggleBranch(b.id)}
                    />
                    {b.name}
                  </label>
                ))
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            {t('create.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || create.isPending}
            onClick={submit}
          >
            {t('create.submit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const cls =
    status === 'active'
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-slate-100 text-slate-500';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

/**
 * One-time secret reveal — mirrors the WebhooksPage pattern.
 *
 *  - Pre-copies the secret to the clipboard on mount.
 *  - Renders it masked behind a "Show" toggle so screen-shares / walk-bys
 *    don't capture it inadvertently.
 *  - Auto-dismisses after 90 seconds so a wandered-off operator doesn't leave
 *    a credential on screen. After dismiss the secret is irretrievable.
 */
function SecretReveal({
  keyId,
  secret,
  onDismiss,
}: {
  keyId: string;
  secret: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation('partnerKeys');
  const [shown, setShown] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(90);

  useEffect(() => {
    navigator.clipboard
      ?.writeText(secret)
      .then(() => toast.success(t('secret.toastCopied')))
      .catch(() => undefined);
  }, [secret, t]);

  // `onDismiss` is a fresh inline function each parent render; pin the latest
  // in a ref so the interval effect's deps can stay empty (no stacked timers).
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
    <div className="rounded-xl border border-amber-400 bg-amber-50 p-4">
      <p className="font-medium text-amber-900">{t('secret.created')}</p>
      <p className="mt-1 text-sm text-amber-800">
        {t('secret.copiedIntro')} <strong>{t('secret.saveNow')}</strong>{' '}
        {t('secret.autoHiding', { seconds: secondsLeft })}
      </p>
      <p className="mt-2 text-xs text-amber-700">
        {t('secret.keyIdLabel')}: <span className="font-mono">{keyId}</span>
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code
          className="flex-1 select-all rounded bg-white p-2 font-mono text-sm"
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
            navigator.clipboard
              ?.writeText(secret)
              .then(() => toast.success(t('secret.toastCopiedShort')));
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
