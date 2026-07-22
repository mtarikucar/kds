import { useState } from 'react';
import { Trash2, ScanLine } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../../components/ui/Card';
import QueryStateGate from '../../../components/ui/QueryStateGate';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import {
  usePoTemplates,
  useCreateOrderFromTemplate,
  useDeletePoTemplate,
  useSupplierReturn,
  lookupBarcode,
} from '../../../features/stock-management/purchasingApi';
import { useSuppliers } from '../../../features/stock-management/stockManagementApi';
import PurchaseOrdersTab from '../../../features/stock-management/components/PurchaseOrdersTab';

type Fmt = (n: number) => string;

// Siparişler = the full PO lifecycle. PurchaseOrdersTab already covers
// create/submit/approve/receive/landed-cost/cancel and the receive modal.
// Templates + barcode + RMA are folded in below as a stacked section, lifted
// verbatim (JSX + hooks) from the old PurchasingPage 'more' tab.
export default function OrdersTab() {
  const fmt = useFormatCurrency();
  return (
    <div className="space-y-8">
      <PurchaseOrdersTab />
      <MoreTab fmt={fmt} />
    </div>
  );
}

// ── Templates + barcode + RMA, lifted verbatim from PurchasingPage.tsx ──

function MoreTab({ fmt }: { fmt: Fmt }) {
  const templatesQuery = usePoTemplates();
  const { data: templates } = templatesQuery;
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
          <QueryStateGate
            query={templatesQuery}
            loading={<Loading />}
            isEmpty={!templates || templates.length === 0}
            empty={<Empty text="Kayıtlı şablon yok." />}
          >
            <ul className="divide-y divide-slate-100">
              {(templates ?? []).map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{t.name} <span className="text-slate-400">({t.items?.length ?? 0} kalem)</span></span>
                  <span className="space-x-3">
                    <button onClick={() => createOrder.mutate(t.id)} disabled={createOrder.isPending} className="text-indigo-600 hover:underline disabled:opacity-50">Sipariş oluştur</button>
                    <button onClick={() => deleteTpl.mutate(t.id)} className="text-slate-400 hover:text-rose-600" aria-label="Sil"><Trash2 className="inline h-4 w-4" /></button>
                  </span>
                </li>
              ))}
            </ul>
          </QueryStateGate>
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

// ── shared bits (lifted from PurchasingPage.tsx) ──
function Loading() {
  return <div className="py-12 text-center text-slate-400">Yükleniyor…</div>;
}
function Empty({ text }: { text: string }) {
  return <div className="py-8 text-center text-slate-400">{text}</div>;
}
