import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { FileCheck, RefreshCw, Building2, TrendingUp, PiggyBank } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../components/ui/Card';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import {
  useEDocumentReadiness,
  useResyncFailedEDocuments,
} from '../../features/accounting/eBelgeApi';
import {
  useConsolidatedPnl,
  useSalesForecast,
} from '../../features/reports/reportsApi';
import { useBudgetVsActual } from '../../features/expenses/expensesApi';

type Tab = 'edoc' | 'budget' | 'consolidated' | 'forecast';

export default function AccountingBackOfficePage() {
  const fmt = useFormatCurrency();
  const [tab, setTab] = useState<Tab>('edoc');
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'edoc', label: 'e-Belge Hazırlık', icon: FileCheck },
    { id: 'budget', label: 'Bütçe vs Fiili', icon: PiggyBank },
    { id: 'consolidated', label: 'Konsolide P&L', icon: Building2 },
    { id: 'forecast', label: 'Satış Tahmini', icon: TrendingUp },
  ];
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Muhasebe & e-Belge</h1>
        <p className="text-sm text-slate-500">e-Belge canlıya-hazırlık, bütçe takibi, çok-şube konsolidasyon ve satış tahmini.</p>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((tb) => {
          const Icon = tb.icon;
          return (
            <button key={tb.id} onClick={() => setTab(tb.id)}
              className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === tb.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              <Icon className="h-4 w-4" />{tb.label}
            </button>
          );
        })}
      </div>
      {tab === 'edoc' && <EDocTab />}
      {tab === 'budget' && <BudgetTab fmt={fmt} />}
      {tab === 'consolidated' && <ConsolidatedTab fmt={fmt} />}
      {tab === 'forecast' && <ForecastTab fmt={fmt} />}
    </div>
  );
}

type Fmt = (n: number) => string;

function EDocTab() {
  const { data, isLoading } = useEDocumentReadiness();
  const resync = useResyncFailedEDocuments();
  if (isLoading) return <Loading />;
  const ready = data?.signerConfigured && data?.mukellefQuery !== 'NONE';
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>e-Belge canlıya-hazırlık</CardTitle></CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <Row ok={data?.mukellefQuery !== 'NONE'} label="GİB mükellef sorgusu" detail={data?.mukellefQuery ?? '—'} />
            <Row ok={!!data?.signerConfigured} label="e-İmza / mali mühür" detail={data?.signer ?? '—'} />
          </ul>
          <div className={`mt-4 rounded-lg p-3 text-sm ${ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {ready
              ? 'Tüm sağlayıcılar yapılandırılmış — e-Belge canlı kesime hazır.'
              : 'Kod yolu tamam ve test edildi. Canlıya geçmek için GİB entegratör credential’ları + mali mühür sertifikası ilgili token’lara bağlanmalı (harici provisioning).'}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Reddedilen (FAILED) e-Belgeleri yeniden gönder</CardTitle></CardHeader>
        <CardContent>
          <button onClick={() => resync.mutate()} disabled={resync.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${resync.isPending ? 'animate-spin' : ''}`} />
            {resync.isPending ? 'Gönderiliyor…' : 'Yeniden gönder'}
          </button>
          {resync.isSuccess && <p className="mt-3 text-sm text-emerald-600">{resync.data?.retried ?? 0} belge yeniden denendi.</p>}
          {resync.isError && <p className="mt-3 text-sm text-rose-600">Yeniden gönderme başarısız (yalnızca ADMIN yetkilidir).</p>}
          <p className="mt-2 text-xs text-slate-500">Saatlik zamanlayıcı FAILED belgeleri otomatik de dener.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function BudgetTab({ fmt }: { fmt: Fmt }) {
  const now = new Date();
  const [ym] = useState({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  const { data, isLoading } = useBudgetVsActual(ym.year, ym.month);
  if (isLoading) return <Loading />;
  return (
    <Card>
      <CardHeader><CardTitle>Bütçe vs Fiili — {ym.year}/{ym.month} (varyans {fmt(data?.totalVariance ?? 0)})</CardTitle></CardHeader>
      <CardContent>
        <Table head={['Kategori', 'Bütçe', 'Fiili', 'Varyans']}
          rows={(data?.byCategory ?? []).map((c: any) => [c.category, fmt(c.budget), fmt(c.actual), (c.overBudget ? '▲ ' : '') + fmt(c.variance)])} />
      </CardContent>
    </Card>
  );
}

function ConsolidatedTab({ fmt }: { fmt: Fmt }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [range] = useState({ startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'), endDate: today });
  const { data, isLoading, isError } = useConsolidatedPnl(range);
  if (isLoading) return <Loading />;
  if (isError)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-amber-700">
          Konsolide P&L yalnızca tüm şubelere erişimi olan yöneticiler içindir.
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardHeader><CardTitle>Konsolide Kâr-Zarar (net {fmt(data?.totals?.netProfit ?? 0)})</CardTitle></CardHeader>
      <CardContent>
        <Table head={['Şube', 'Ciro', 'SMM', 'Gider', 'Net kâr', 'Net %']}
          rows={(data?.perBranch ?? []).map((b: any) => [b.branchName, fmt(b.revenue), fmt(b.cogs), fmt(b.operatingExpenses), fmt(b.netProfit), b.netMarginPct != null ? `%${b.netMarginPct}` : '—'])} />
      </CardContent>
    </Card>
  );
}

function ForecastTab({ fmt }: { fmt: Fmt }) {
  const { data, isLoading } = useSalesForecast();
  if (isLoading) return <Loading />;
  return (
    <Card>
      <CardHeader><CardTitle>Satış tahmini — {data?.horizonDays ?? 7} gün, tahmini toplam {fmt(data?.projectedTotal ?? 0)}</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-slate-500">Yöntem: {data?.method}. Günlük ort. {fmt(data?.avgDailyRevenue ?? 0)}.</p>
        <Table head={['Tarih', 'Tahmini ciro']} rows={(data?.forecast ?? []).map((f: any) => [f.date, fmt(f.forecastRevenue)])} />
      </CardContent>
    </Card>
  );
}

function Loading() { return <div className="py-12 text-center text-slate-400">Yükleniyor…</div>; }
function Row({ ok, label, detail }: { ok?: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      <span className="flex-1">{label}</span>
      <span className="text-slate-500">{detail}</span>
    </li>
  );
}
function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500">{head.map((h) => <th key={h} className="py-2 pr-4">{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={head.length} className="py-6 text-center text-slate-400">Kayıt yok.</td></tr>
          : rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="py-2 pr-4 tabular-nums">{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
