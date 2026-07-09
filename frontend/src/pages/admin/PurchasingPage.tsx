import { useState } from 'react';
import {
  ShoppingCart,
  AlertTriangle,
  Award,
  ArrowLeftRight,
  Boxes,
  FileStack,
  ScanLine,
  Trash2,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../components/ui/Card';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { toast } from 'sonner';
import {
  useReorderSuggestions,
  useApAging,
  useSupplierScorecard,
  useBatchValuation,
  useStockTransfers,
  useCreateStockTransfer,
  useBranchStockItems,
  useCompleteStockTransfer,
  useCancelStockTransfer,
  usePoTemplates,
  useCreateOrderFromTemplate,
  useDeletePoTemplate,
  useSupplierReturn,
  lookupBarcode,
} from '../../features/stock-management/purchasingApi';
import {
  useSuppliers,
  useStockItems,
} from '../../features/stock-management/stockManagementApi';
import { useListBranches } from '../../features/branches/branchesApi';
import { useBranchScopeStore } from '../../store/branchScopeStore';

type Tab = 'reorder' | 'ap' | 'suppliers' | 'transfers' | 'valuation' | 'more';

export default function PurchasingPage() {
  const fmt = useFormatCurrency();
  const [tab, setTab] = useState<Tab>('reorder');

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'reorder', label: 'Sipariş Önerileri', icon: ShoppingCart },
    { id: 'ap', label: 'Borç Yaşlandırma', icon: AlertTriangle },
    { id: 'suppliers', label: 'Tedarikçi Karnesi', icon: Award },
    { id: 'transfers', label: 'Şube Transferleri', icon: ArrowLeftRight },
    { id: 'valuation', label: 'Stok Değerleme', icon: Boxes },
    { id: 'more', label: 'Şablonlar & Barkod', icon: FileStack },
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
      {tab === 'more' && <MoreTab fmt={fmt} />}
    </div>
  );
}

function MoreTab({ fmt }: { fmt: Fmt }) {
  const { data: templates, isLoading } = usePoTemplates();
  const createOrder = useCreateOrderFromTemplate();
  const deleteTpl = useDeletePoTemplate();
  const [barcode, setBarcode] = useState('');
  const [found, setFound] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);

  const onLookup = async () => {
    setNotFound(false);
    setFound(null);
    if (!barcode.trim()) return;
    try {
      setFound(await lookupBarcode(barcode.trim()));
    } catch {
      setNotFound(true);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle>Sipariş şablonları</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Loading /> : (!templates || templates.length === 0) ? (
            <Empty text="Kayıtlı şablon yok." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{t.name} <span className="text-slate-400">({t.items?.length ?? 0} kalem)</span></span>
                  <span className="space-x-3">
                    <button onClick={() => createOrder.mutate(t.id)} disabled={createOrder.isPending} className="text-indigo-600 hover:underline disabled:opacity-50">Sipariş oluştur</button>
                    <button onClick={() => deleteTpl.mutate(t.id)} className="text-slate-400 hover:text-rose-600" aria-label="Sil"><Trash2 className="inline h-4 w-4" /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {createOrder.isSuccess && <p className="mt-3 text-sm text-emerald-600">Taslak sipariş oluşturuldu.</p>}
          {(createOrder.isError || deleteTpl.isError) && <p className="mt-3 text-sm text-rose-600">İşlem başarısız — şablondaki bir kalem/tedarikçi silinmiş olabilir.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Barkod ile stok arama</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <input
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onLookup()}
              placeholder="Barkod okut / yaz"
              className="flex-1 rounded-md border-slate-300 text-sm"
            />
            <button onClick={onLookup} className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              <ScanLine className="h-4 w-4" /> Ara
            </button>
          </div>
          {found && (
            <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm">
              <p className="font-semibold">{found.name}</p>
              <p className="text-slate-600">Stok: {found.currentStock} {found.unit} · Maliyet: {fmt(Number(found.costPerUnit ?? 0))} · Barkod: {found.barcode}</p>
              <SupplierReturnForm
                stockItemId={found.id}
                stockItemName={found.name}
                onReturned={(q) =>
                  setFound((f: any) =>
                    f ? { ...f, currentStock: Number(f.currentStock) - q } : f
                  )
                }
              />
            </div>
          )}
          {notFound && <p className="mt-3 text-sm text-rose-600">Bu barkodla eşleşen stok kalemi bulunamadı.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function SupplierReturnForm({ stockItemId, stockItemName, onReturned }: { stockItemId: string; stockItemName: string; onReturned?: (qty: number) => void }) {
  const { data: suppliers } = useSuppliers();
  const ret = useSupplierReturn();
  const [supplierId, setSupplierId] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');

  const submit = () => {
    if (!supplierId || !Number(qty)) return;
    const returnedQty = Number(qty);
    ret.mutate(
      {
        supplierId,
        reason: reason || undefined,
        items: [{ stockItemId, quantity: returnedQty }],
      },
      {
        // Reset after a successful return so a second click can't re-submit the
        // same decrement against a stale form, and refresh the parent's stock
        // card so the displayed on-hand reflects the return.
        onSuccess: () => {
          onReturned?.(returnedQty);
          setSupplierId('');
          setQty('');
          setReason('');
        },
      }
    );
  };

  return (
    <div className="mt-3 border-t border-emerald-200 pt-3">
      <p className="mb-2 font-medium text-slate-700">Tedarikçiye iade (RMA) — {stockItemName}</p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="rounded-md border-slate-300 text-sm">
          <option value="">Tedarikçi seç</option>
          {(suppliers as any[])?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" step="0.001" placeholder="Miktar" className="rounded-md border-slate-300 text-sm" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sebep" className="rounded-md border-slate-300 text-sm" />
        <button onClick={submit} disabled={ret.isPending} className="rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
          {ret.isPending ? '…' : 'İade et'}
        </button>
      </div>
      {ret.isSuccess && <p className="mt-2 text-xs text-emerald-700">İade kaydedildi, stok düşüldü.</p>}
      {ret.isError && <p className="mt-2 text-xs text-rose-600">İade başarısız — stok yetersiz olabilir.</p>}
    </div>
  );
}

type Fmt = (n: number) => string;

function ReorderTab({ fmt }: { fmt: Fmt }) {
  const { data, isLoading } = useReorderSuggestions();
  if (isLoading) return <Loading />;
  // Backend shape: { draftOrders: [{ supplierName, items: [...] }], unassigned, totalItemsBelowPar }
  const draftOrders: any[] = data?.draftOrders ?? [];
  const unassigned: any[] = data?.unassigned ?? [];
  const rows = [
    ...draftOrders.flatMap((s: any) =>
      (s.items ?? []).map((l: any) => [
        s.supplierName ?? '—',
        l.stockItemName ?? l.name ?? '—',
        `${l.suggestedQty ?? l.suggestedQuantity ?? ''} ${l.unit ?? ''}`,
        l.estimatedCost != null ? fmt(l.estimatedCost) : '—',
      ])
    ),
    ...unassigned.map((l: any) => [
      'Tedarikçisiz',
      l.stockItemName ?? l.name ?? '—',
      `${l.suggestedQty ?? l.suggestedQuantity ?? ''} ${l.unit ?? ''}`,
      l.estimatedCost != null ? fmt(l.estimatedCost) : '—',
    ]),
  ];
  return (
    <Card>
      <CardHeader><CardTitle>Par altı kalemler için sipariş önerileri ({data?.totalItemsBelowPar ?? rows.length})</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <Empty text="Sipariş önerisi yok — stoklar par seviyesinin üzerinde." />
        ) : (
          <Table head={['Tedarikçi', 'Kalem', 'Önerilen', 'Tahmini tutar']} rows={rows} />
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
            rows={(data?.bySupplier ?? []).map((s: any) => [s.supplierName ?? s.supplierId, String(s.count), fmt(s.total)])}
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
  const busy = complete.isPending || cancel.isPending;
  const onErr = () => toast.error('Transfer işlemi başarısız — sayfayı yenileyip tekrar deneyin.');
  if (isLoading) return <Loading />;
  return (
    <div className="space-y-4">
    <CreateTransferForm />
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
                          <button disabled={busy} onClick={() => complete.mutate(t.id, { onError: onErr })} className="text-emerald-600 hover:underline disabled:opacity-50">Tamamla</button>
                          <button disabled={busy} onClick={() => cancel.mutate(t.id, { onError: onErr })} className="text-rose-600 hover:underline disabled:opacity-50">İptal</button>
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
    </div>
  );
}

function CreateTransferForm() {
  const myBranchId = useBranchScopeStore((s) => s.branchId);
  const allowedBranchIds = useBranchScopeStore((s) => s.allowedBranchIds);
  const { data: branches } = useListBranches();
  const { data: sourceItems } = useStockItems();
  const [toBranchId, setToBranchId] = useState('');
  const { data: destItems, isError: destError } = useBranchStockItems(toBranchId || undefined);
  const [sourceStockItemId, setSource] = useState('');
  const [destStockItemId, setDest] = useState('');
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const create = useCreateStockTransfer();

  // Only ACTIVE branches the caller is authorized for (empty allow-list =
  // wildcard ADMIN) — the backend enforces the same rule; filtering here just
  // avoids offering targets that would dead-end at the dest-item fetch.
  const targets = (branches ?? []).filter(
    (b: any) =>
      b.id !== myBranchId &&
      (b.status == null || b.status === 'active') &&
      (allowedBranchIds.length === 0 || allowedBranchIds.includes(b.id))
  );
  const canSubmit = toBranchId && sourceStockItemId && destStockItemId && Number(qty) > 0;

  const submit = () => {
    if (!canSubmit) return;
    create.mutate(
      {
        toBranchId,
        items: [{
          sourceStockItemId,
          destStockItemId,
          quantity: Number(qty),
          unitCost: Number(unitCost) > 0 ? Number(unitCost) : undefined,
        }],
      },
      {
        onSuccess: () => {
          toast.success('Transfer oluşturuldu (beklemede) — Tamamla ile stok taşınır.');
          setSource(''); setDest(''); setQty(''); setUnitCost('');
        },
        onError: (e: any) =>
          toast.error(e?.response?.data?.message ?? 'Transfer oluşturulamadı.'),
      }
    );
  };

  return (
    <Card>
      <CardHeader><CardTitle>Yeni transfer oluştur</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
          <select value={toBranchId} onChange={(e) => { setToBranchId(e.target.value); setDest(''); }} className="rounded-md border-slate-300 text-sm" aria-label="Hedef şube">
            <option value="">Hedef şube</option>
            {targets.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={sourceStockItemId} onChange={(e) => setSource(e.target.value)} className="rounded-md border-slate-300 text-sm" aria-label="Kaynak kalem">
            <option value="">Kaynak kalem (bu şube)</option>
            {(sourceItems ?? []).map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <select value={destStockItemId} onChange={(e) => setDest(e.target.value)} disabled={!toBranchId} className="rounded-md border-slate-300 text-sm disabled:opacity-50" aria-label="Hedef kalem">
            <option value="">{toBranchId ? 'Hedef kalem' : 'Önce şube seçin'}</option>
            {(destItems ?? []).map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min="0" step="0.001" placeholder="Miktar" className="rounded-md border-slate-300 text-sm" />
          <div className="flex gap-2">
            <input value={unitCost} onChange={(e) => setUnitCost(e.target.value)} type="number" min="0" step="0.01" placeholder="Birim maliyet (ops.)" className="flex-1 rounded-md border-slate-300 text-sm" />
            <button onClick={submit} disabled={!canSubmit || create.isPending} className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {create.isPending ? '…' : 'Oluştur'}
            </button>
          </div>
        </div>
        {destError && (
          <p className="mt-2 text-xs text-rose-600">Hedef şubenin kalemleri yüklenemedi — bu şube için yetkiniz olmayabilir.</p>
        )}
        <p className="mt-2 text-xs text-slate-500">Birim maliyet girilirse hedef şubenin maliyet tabanına işlenir; boşsa hedef kalemin mevcut maliyeti kullanılır.</p>
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
