import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { UserRole } from '../../types';
import {
  useListPendingReceipts,
  useRetryReceipt,
  useListFiscalDevices,
  useRegisterFiscalDevice,
  useRetireFiscalDevice,
  type FiscalReceipt,
  type FiscalDevice,
} from './fiscalApi';

/**
 * Manual recovery panel for fiscal receipts.
 *
 * Surfaces every receipt that hasn't successfully issued. Operators click
 * Retry; the backend re-dispatches against the original idempotency key so
 * the device will not double-issue.
 *
 * Polls every 20s — the table is cheap (limited to the latest 100 pending
 * rows) and the live status feedback matters for ops during incidents.
 */
export default function FiscalRecoveryPage() {
  const { t } = useTranslation('common');
  const { data: rows = [], isLoading, refetch } = useListPendingReceipts();
  const retry = useRetryReceipt();

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('hummytummy.fiscalRecovery.title')}</h1>
          <p className="text-sm text-gray-600">{t('hummytummy.fiscalRecovery.subtitle')}</p>
        </div>
        <button onClick={() => refetch()} className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50">
          {t('hummytummy.fiscalRecovery.refresh')}
        </button>
      </header>

      <FiscalDevicesPanel />

      <h2 className="pt-2 text-lg font-semibold">{t('hummytummy.fiscalRecovery.title')}</h2>
      {isLoading ? (
        <div className="text-sm text-gray-500">{t('hummytummy.common.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="rounded border border-dashed p-8 text-center text-sm text-gray-500">
          {t('hummytummy.fiscalRecovery.empty')}
        </div>
      ) : (
        <table className="w-full divide-y rounded border text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{t('hummytummy.fiscalRecovery.col.created')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.fiscalRecovery.col.provider')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.fiscalRecovery.col.order')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.fiscalRecovery.col.status')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.fiscalRecovery.col.total')}</th>
              <th className="px-3 py-2 font-medium">{t('hummytummy.fiscalRecovery.col.lastError')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r: FiscalReceipt) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2 text-xs">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.providerId}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.orderId ?? '—'}</td>
                <td className="px-3 py-2">
                  <StatusPill status={r.status} attempts={r.attempts} />
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {(r.totalCents / 100).toLocaleString('tr-TR', { style: 'currency', currency: r.currency })}
                </td>
                <td className="px-3 py-2 text-xs text-red-700 max-w-sm break-words">
                  {r.lastError ?? '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                    disabled={retry.isPending}
                    onClick={() => retry.mutate(r.id)}
                  >
                    {t('hummytummy.fiscalRecovery.retry')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Register / list / retire physical fiscal devices (yazarkasa / ÖKC).
 *
 * HONESTY: this is the create-site that makes the payment-finalizer's
 * yazarkasa-receipt path reachable — but it does NOT make receipts print.
 * A real GMP-3 ÖKC only issues once its certified hardware is wired through
 * the local bridge and the bridge acks. The banner says so plainly so an
 * operator never reads "registered" as "fiscalizing".
 */
function FiscalDevicesPanel() {
  const { t } = useTranslation('common');
  const { data: devices = [], isLoading } = useListFiscalDevices();
  const register = useRegisterFiscalDevice();
  const retire = useRetireFiscalDevice();
  // Register / retire are ADMIN-only on the backend; don't show controls that
  // would just 403 for a MANAGER. MANAGERs still see the device list.
  const isAdmin = useAuthStore((s) => s.user?.role) === UserRole.ADMIN;

  const [providerId, setProviderId] = useState('fiscal_hugin');
  const [serial, setSerial] = useState('');
  const [model, setModel] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serial.trim()) return;
    register.mutate(
      { providerId, serial: serial.trim(), model: model.trim() || undefined },
      {
        onSuccess: () => {
          setSerial('');
          setModel('');
        },
      },
    );
  };

  return (
    <section className="space-y-3 rounded border p-4">
      <div>
        <h2 className="text-lg font-semibold">{t('hummytummy.fiscalDevices.title')}</h2>
        <p className="mt-1 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('hummytummy.fiscalDevices.gateNote')}
        </p>
      </div>

      {isAdmin && (
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs">
          <span className="mb-1 text-gray-600">{t('hummytummy.fiscalDevices.provider')}</span>
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            className="rounded border px-2 py-1.5 text-sm"
          >
            <option value="fiscal_hugin">Hugin</option>
            <option value="fiscal_beko">Beko</option>
            <option value="fiscal_paygo">Paygo (SP630)</option>
          </select>
        </label>
        <label className="flex flex-col text-xs">
          <span className="mb-1 text-gray-600">{t('hummytummy.fiscalDevices.serial')}</span>
          <input
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            className="rounded border px-2 py-1.5 text-sm"
            placeholder="ÖKC-…"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="mb-1 text-gray-600">{t('hummytummy.fiscalDevices.model')}</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded border px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={register.isPending || !serial.trim()}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {t('hummytummy.fiscalDevices.register')}
        </button>
      </form>
      )}

      {isLoading ? (
        <div className="text-sm text-gray-500">{t('hummytummy.common.loading')}</div>
      ) : devices.length === 0 ? (
        <div className="text-sm text-gray-500">{t('hummytummy.fiscalDevices.empty')}</div>
      ) : (
        <ul className="divide-y rounded border text-sm">
          {devices.map((d: FiscalDevice) => (
            <li key={d.id} className="flex items-center justify-between px-3 py-2">
              <div>
                <span className="font-mono text-xs">{d.providerId}</span>
                <span className="mx-2 text-gray-400">·</span>
                <span>{d.serial}</span>
                {d.model && <span className="ml-2 text-gray-500">{d.model}</span>}
                <span className="ml-2 inline-flex rounded bg-gray-100 px-2 py-0.5 text-xs">
                  {d.status}
                </span>
              </div>
              {isAdmin && d.status !== 'retired' && (
                <button
                  className="rounded border px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                  disabled={retire.isPending}
                  onClick={() => retire.mutate(d.id)}
                >
                  {t('hummytummy.fiscalDevices.retire')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusPill({ status, attempts }: { status: string; attempts: number }) {
  const colors: Record<string, string> = {
    queued: 'bg-blue-100 text-blue-800',
    failed: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-100'}`}>
      {status}
      {attempts > 0 && <span className="opacity-60">×{attempts}</span>}
    </span>
  );
}
