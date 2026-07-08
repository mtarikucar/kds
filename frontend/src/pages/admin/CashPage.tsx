import { useState } from 'react';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';
import { useForm } from 'react-hook-form';
import { Wallet, Coins, Printer, Landmark } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../components/ui/Card';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import {
  useCashierSessions,
  useXReport,
  useCreateCashMovement,
  useTipDistribution,
  useOkcDevice,
  downloadSessionsCsv,
} from '../../features/cash/cashApi';

type Tab = 'sessions' | 'safe' | 'tips' | 'okc';

export default function CashPage() {
  const fmt = useFormatCurrency();
  const [tab, setTab] = useState<Tab>('sessions');
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'sessions', label: 'Vardiyalar & X-Report', icon: Wallet },
    { id: 'safe', label: 'Kasa / Petty Cash', icon: Landmark },
    { id: 'tips', label: 'Bahşiş Havuzu', icon: Coins },
    { id: 'okc', label: 'ÖKC', icon: Printer },
  ];
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nakit & ÖKC</h1>
        <p className="text-sm text-slate-500">Vardiya mutabakatı, kasa hareketleri, bahşiş dağıtımı ve yazarkasa.</p>
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
      {tab === 'sessions' && <SessionsTab fmt={fmt} />}
      {tab === 'safe' && <SafeTab fmt={fmt} />}
      {tab === 'tips' && <TipsTab fmt={fmt} />}
      {tab === 'okc' && <OkcTab />}
    </div>
  );
}

type Fmt = (n: number) => string;

function SessionsTab({ fmt }: { fmt: Fmt }) {
  const { data: sessions, isLoading } = useCashierSessions('OPEN');
  const [selected, setSelected] = useState<string | undefined>();
  const { data: x, isLoading: xLoading } = useXReport(selected);
  if (isLoading) return <Loading />;
  return (
    <div className="space-y-4">
    <div className="flex justify-end">
      <button
        onClick={async () => {
          try {
            await downloadSessionsCsv();
          } catch {
            toast.error('CSV indirilemedi — tekrar deneyin.');
          }
        }}
        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
      >
        Z geçmişi CSV indir
      </button>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle>Açık vardiyalar</CardTitle></CardHeader>
        <CardContent>
          {(!sessions || sessions.length === 0) ? <Empty text="Açık vardiya yok." /> : (
            <ul className="divide-y divide-slate-100">
              {sessions.map((s: any) => (
                <li key={s.id}>
                  <button onClick={() => setSelected(s.id)}
                    className={`w-full text-left py-2 px-1 text-sm hover:bg-slate-50 ${selected === s.id ? 'bg-indigo-50' : ''}`}>
                    Vardiya {s.id.slice(0, 8)} — açılış {fmt(Number(s.openingFloat))}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>X-Report (kapatmadan)</CardTitle></CardHeader>
        <CardContent>
          {xLoading ? <Loading /> : !x ? <Empty text="Soldan bir vardiya seçin." /> : (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <KV label="Açılış" value={fmt(x.openingFloat)} />
              <KV label="Nakit satış" value={fmt(x.cashSales)} />
              <KV label="Kasa girişi" value={fmt(x.cashIn)} />
              <KV label="Kasa çıkışı" value={fmt(x.cashOut)} />
              <KV label="Beklenen nakit" value={fmt(x.expectedCash)} strong />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </div>
  );
}

function SafeTab({ fmt }: { fmt: Fmt }) {
  const create = useCreateCashMovement();
  const { register, handleSubmit, reset } = useForm<{ type: string; amount: number; reason: string }>({
    defaultValues: { type: 'SAFE_DROP' },
  });
  const onSubmit = (d: { type: string; amount: number; reason: string }) =>
    create.mutate({ ...d, amount: Number(d.amount) }, { onSuccess: () => reset({ type: d.type }) });
  return (
    <Card>
      <CardHeader><CardTitle>Kasa hareketi (safe / petty cash / banka)</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-slate-500">Kasadan çıkan para — onaya düşer, vardiya mutabakatında çıkış olarak sayılır.</p>
        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
          <select {...register('type')} className="rounded-md border-slate-300 text-sm">
            <option value="SAFE_DROP">Kasaya devir (SAFE_DROP)</option>
            <option value="BANK_DEPOSIT">Banka yatırma</option>
            <option value="PETTY_CASH">Küçük kasa (petty)</option>
            <option value="CASH_OUT">Nakit çıkış</option>
          </select>
          <input {...register('amount', { required: true, valueAsNumber: true })} type="number" step="0.01" placeholder="Tutar" className="rounded-md border-slate-300 text-sm" />
          <input {...register('reason')} placeholder="Açıklama" className="rounded-md border-slate-300 text-sm" />
          <button type="submit" disabled={create.isPending} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {create.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </form>
        {create.isSuccess && <p className="mt-3 text-sm text-emerald-600">Hareket kaydedildi (onay bekliyor). Tutar: {fmt(create.data?.amount ?? 0)}</p>}
      </CardContent>
    </Card>
  );
}

function TipsTab({ fmt }: { fmt: Fmt }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [range] = useState({ startDate: format(subDays(new Date(), 7), 'yyyy-MM-dd'), endDate: today });
  const { data, isLoading } = useTipDistribution(range);
  if (isLoading) return <Loading />;
  return (
    <Card>
      <CardHeader><CardTitle>Bahşiş havuzu dağıtımı — havuz {fmt(data?.pool ?? 0)}, {data?.totalHours ?? 0} saat</CardTitle></CardHeader>
      <CardContent>
        <Table head={['Personel', 'Saat', 'Pay']}
          rows={(data?.distribution ?? []).map((d: any) => [d.staffName, String(d.hours), fmt(d.tipShare)])} />
        {data?.undistributed > 0 && <p className="mt-3 text-xs text-amber-600">Dağıtılmayan: {fmt(data.undistributed)} (saat girilmemiş).</p>}
      </CardContent>
    </Card>
  );
}

function OkcTab() {
  const { data, isLoading } = useOkcDevice();
  if (isLoading) return <Loading />;
  return (
    <Card>
      <CardHeader><CardTitle>Yazarkasa (ÖKC) durumu</CardTitle></CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 text-sm">
          <span className={`h-3 w-3 rounded-full ${data?.available ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          <span>Sağlayıcı: <strong>{data?.device ?? '—'}</strong></span>
          <span>{data?.available ? 'Hazır' : 'Cihaz yapılandırılmamış'}</span>
        </div>
        {!data?.available && (
          <p className="mt-3 text-xs text-slate-500">
            Mali fiş basmak için bir ÖKC cihaz sağlayıcısı (vendor SDK) bağlanmalı. Fiş üretimi + akış hazır; yalnızca fiziksel cihaz adaptörü eksik.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Loading() { return <div className="py-12 text-center text-slate-400">Yükleniyor…</div>; }
function Empty({ text }: { text: string }) { return <div className="py-8 text-center text-slate-400">{text}</div>; }
function KV({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div><p className="text-slate-500">{label}</p><p className={`tabular-nums ${strong ? 'text-lg font-bold' : 'font-semibold'}`}>{value}</p></div>;
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
