import { useState } from 'react';
import { Receipt, FileCheck, Settings2, RefreshCw } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../components/ui/Card';
import {
  useEDocumentReadiness,
  useResyncFailedEDocuments,
} from '../../features/accounting/eBelgeApi';
import { InvoicesPanel } from './invoices/InvoicesPage';
import { AccountingSettingsPanel } from '../settings/AccountingSettingsPage';

type Tab = 'invoices' | 'edoc' | 'settings';

/**
 * Muhasebe — the single home for everything e-Belge. Three tabs:
 *  • Faturalar    — the issued legal documents (list + sync/credit-note/cancel)
 *  • e-Belge Durumu — go-live readiness checklist + FAILED-document resync
 *  • Ayarlar      — company identity + integrator credentials + certificate
 * Management reports (budget / consolidated P&L / forecast) live under Raporlar.
 */
export default function AccountingBackOfficePage() {
  const [tab, setTab] = useState<Tab>('invoices');
  const tabs: {
    id: Tab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'invoices', label: 'Faturalar', icon: Receipt },
    { id: 'edoc', label: 'e-Belge Durumu', icon: FileCheck },
    { id: 'settings', label: 'Ayarlar', icon: Settings2 },
  ];
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Muhasebe</h1>
        <p className="text-sm text-slate-500">
          Faturalar, e-Belge durumu ve entegratör ayarları — hepsi tek yerde.
        </p>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((tb) => {
          const Icon = tb.icon;
          return (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === tb.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tb.label}
            </button>
          );
        })}
      </div>
      {tab === 'invoices' && <InvoicesPanel />}
      {tab === 'edoc' && <EDocTab />}
      {tab === 'settings' && <AccountingSettingsPanel />}
    </div>
  );
}

function EDocTab() {
  const { data, isLoading } = useEDocumentReadiness();
  const resync = useResyncFailedEDocuments();
  if (isLoading) return <Loading />;
  const ready = data?.signerConfigured && data?.mukellefQuery !== 'NONE';
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Canlıya-hazırlık kontrolü</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <Row
              ok={data?.mukellefQuery !== 'NONE'}
              label="GİB mükellef sorgusu (entegratör)"
              detail={data?.mukellefQuery ?? '—'}
            />
            <Row
              ok={!!data?.signerConfigured}
              label="e-İmza / mali mühür sertifikası"
              detail={data?.signer ?? '—'}
            />
          </ul>
          <div
            className={`mt-4 rounded-lg p-3 text-sm ${
              ready
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            {ready
              ? 'Tüm sağlayıcılar yapılandırılmış — e-Belge canlı kesime hazır.'
              : 'Kod yolu tamam ve test edildi. Canlıya geçmek için Ayarlar sekmesinden entegratör kimliği + mali mühür sertifikası bağlanmalı (harici tedarik).'}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Reddedilen (FAILED) e-Belgeleri yeniden gönder</CardTitle>
        </CardHeader>
        <CardContent>
          <button
            onClick={() => resync.mutate()}
            disabled={resync.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${resync.isPending ? 'animate-spin' : ''}`}
            />
            {resync.isPending ? 'Gönderiliyor…' : 'Yeniden gönder'}
          </button>
          {resync.isSuccess && (
            <p className="mt-3 text-sm text-emerald-600">
              {resync.data?.retried ?? 0} belge yeniden denendi.
            </p>
          )}
          {resync.isError && (
            <p className="mt-3 text-sm text-rose-600">
              {(resync.error as any)?.response?.status === 403
                ? 'Yeniden gönderme için ADMIN yetkisi gerekli.'
                : 'Yeniden gönderme başarısız — tekrar deneyin.'}
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Saatlik zamanlayıcı FAILED belgeleri otomatik de dener.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Loading() {
  return (
    <div className="py-12 text-center text-slate-400">Yükleniyor…</div>
  );
}
function Row({
  ok,
  label,
  detail,
}: {
  ok?: boolean;
  label: string;
  detail: string;
}) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`}
      />
      <span className="flex-1">{label}</span>
      <span className="text-slate-500">{detail}</span>
    </li>
  );
}
