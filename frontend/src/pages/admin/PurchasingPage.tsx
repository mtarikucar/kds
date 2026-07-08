import { useState } from 'react';
import {
  ShoppingCart,
  AlertTriangle,
  Award,
  ArrowLeftRight,
  Boxes,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../components/ui/Card';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import {
  useReorderSuggestions,
  useApAging,
  useSupplierScorecard,
  useBatchValuation,
  useStockTransfers,
  useCompleteStockTransfer,
  useCancelStockTransfer,
} from '../../features/stock-management/purchasingApi';

type Tab = 'reorder' | 'ap' | 'suppliers' | 'transfers' | 'valuation';

export default function PurchasingPage() {
  const fmt = useFormatCurrency();
  const [tab, setTab] = useState<Tab>('reorder');

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'reorder', label: 'Sipariş Önerileri', icon: ShoppingCart },
    { id: 'ap', label: 'Borç Yaşlandırma', icon: AlertTriangle },
    { id: 'suppliers', label: 'Tedarikçi Karnesi', icon: Award },
    { id: 'transfers', label: 'Şube Transferleri', icon: ArrowLeftRight },
    { id: 'valuation', label: 'Stok Değerleme', icon: Boxes },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Satın Alma & Stok</h1>
        <p className="text-sm text-slate-500">
          Sipariş önerileri, borç yaşlandırma, tedarikçi performansı, şube transferleri ve stok değerleme.
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

      {tab === 'reorder' && <ReorderTab fmt={fmt} />}
      {tab === 'ap' && <ApAgingTab fmt={fmt} />}
      {tab === 'suppliers' && <SuppliersTab fmt={fmt} />}
      {tab === 'transfers' && <TransfersTab />}
      {tab === 'valuation' && <ValuationTab fmt={fmt} />}
    </div>
  );
}

type Fmt = (n: number) => string;

function ReorderTab({ fmt }: { fmt: Fmt }) {
  const { data, isLoading } = useReorderSuggestions();
  const lines: any[] = data?.suggestions ?? data ?? [];
  if (isLoading) return <Loading />;
  return (
    <Card>
      <CardHeader><CardTitle>Par altı kalemler için sipariş önerileri</CardTitle></CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <Empty text="Sipariş önerisi yok — stoklar par seviyesinin üzerinde." />
        ) : (
          <Table
            head={['Tedarikçi', 'Kalem', 'Önerilen', 'Tahmini tutar']}
            rows={lines.flatMap((s: any) =>
              (s.lines ?? [s]).map((l: any) => [
                s.supplierName ?? '—',
                l.stockItemName ?? l.name ?? '—',
                `${l.suggestedQuantity ?? l.quantity ?? ''} ${l.unit ?? ''}`,
                l.estimatedCost != null ? fmt(l.estimatedCost) : '—',
              ])
            )}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ApAgingTab({ fmt }: { fmt: Fmt }) {
  const { data, isLoading } = useApAging();
  if (isLoading) return <Loading />;
  const b = data?.buckets ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="0-30 gün" value={fmt(b.current ?? 0)} />
        <Stat label="31-60 gün" value={fmt(b.d31_60 ?? 0)} tone="amber" />
        <Stat label="61-90 gün" value={fmt(b.d61_90 ?? 0)} tone="amber" />
        <Stat label="90+ gün" value={fmt(b.d90plus ?? 0)} tone="rose" />
      </div>
      <Card>
        <CardHeader><CardTitle>Tedarikçi bazında ödenmemiş ({fmt(data?.total ?? 0)})</CardTitle></CardHeader>
        <CardContent>
          <Table
            head={['Tedarikçi', 'Fatura sayısı', 'Toplam']}
            rows={(data?.bySupplier ?? []).map((s: any) => [s.supplierId, String(s.count), fmt(s.total)])}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function SuppliersTab({ fmt }: { fmt: Fmt }) {
  const { data, isLoading } = useSupplierScorecard();
  if (isLoading) return <Loading />;
  return (
    <Card>
      <CardHeader><CardTitle>Tedarikçi performansı</CardTitle></CardHeader>
      <CardContent>
        <Table
          head={['Tedarikçi', 'PO', 'Zamanında %', 'Karşılama %', 'Harcama']}
          rows={(data?.suppliers ?? []).map((s: any) => [
            s.supplierName,
            String(s.poCount),
            s.onTimePct != null ? `%${s.onTimePct}` : '—',
            s.fillRatePct != null ? `%${s.fillRatePct}` : '—',
            fmt(s.totalSpend),
          ])}
        />
      </CardContent>
    </Card>
  );
}

function TransfersTab() {
  const { data, isLoading } = useStockTransfers();
  const complete = useCompleteStockTransfer();
  const cancel = useCancelStockTransfer();
  if (isLoading) return <Loading />;
  return (
    <Card>
      <CardHeader><CardTitle>Şubeler arası stok transferleri</CardTitle></CardHeader>
      <CardContent>
        {(!data || data.length === 0) ? (
          <Empty text="Transfer kaydı yok." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500">
                <th className="py-2">No</th><th>Durum</th><th>Kalem</th><th />
              </tr></thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="py-2">{t.transferNumber}</td>
                    <td><StatusPill status={t.status} /></td>
                    <td>{t.items?.length ?? 0}</td>
                    <td className="text-right space-x-2">
                      {t.status === 'PENDING' && (
                        <>
                          <button onClick={() => complete.mutate(t.id)} className="text-emerald-600 hover:underline">Tamamla</button>
                          <button onClick={() => cancel.mutate(t.id)} className="text-rose-600 hover:underline">İptal</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ValuationTab({ fmt }: { fmt: Fmt }) {
  const { data, isLoading } = useBatchValuation();
  if (isLoading) return <Loading />;
  return (
    <Card>
      <CardHeader><CardTitle>FIFO batch değerleme — toplam {fmt(data?.totalValue ?? 0)} ({data?.itemCount ?? 0} kalem)</CardTitle></CardHeader>
      <CardContent>
        <Table
          head={['Kalem', 'Miktar', 'Değer']}
          rows={(data?.items ?? []).map((i: any) => [i.name, `${i.quantity} ${i.unit}`, fmt(i.value)])}
        />
      </CardContent>
    </Card>
  );
}

// ── shared bits ──
function Loading() {
  return <div className="py-12 text-center text-slate-400">Yükleniyor…</div>;
}
function Empty({ text }: { text: string }) {
  return <div className="py-8 text-center text-slate-400">{text}</div>;
}
function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500">{head.map((h) => <th key={h} className="py-2 pr-4">{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={head.length} className="py-6 text-center text-slate-400">Kayıt yok.</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((c, j) => <td key={j} className="py-2 pr-4 tabular-nums">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Stat({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'amber' | 'rose' }) {
  const colors: Record<string, string> = { slate: 'text-slate-900', amber: 'text-amber-600', rose: 'text-rose-600' };
  return (
    <Card><CardContent className="pt-6">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${colors[tone]}`}>{value}</p>
    </CardContent></Card>
  );
}
function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-700',
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    CANCELLED: 'bg-slate-100 text-slate-500',
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs ${map[status] ?? 'bg-slate-100'}`}>{status}</span>;
}
