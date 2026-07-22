import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowRightLeft, Trash2, ClipboardCheck, Building2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../../components/ui/Card';
import { ErrorState } from '../../../components/ui/ErrorState';
import MovementsTab from '../../../features/stock-management/components/MovementsTab';
import WasteLogTab from '../../../features/stock-management/components/WasteLogTab';
import StockCountsTab from '../../../features/stock-management/components/StockCountsTab';
import {
  useStockTransfers,
  useCreateStockTransfer,
  useBranchStockItems,
  useCompleteStockTransfer,
  useCancelStockTransfer,
} from '../../../features/stock-management/purchasingApi';
import { useStockItems } from '../../../features/stock-management/stockManagementApi';
import { useListBranches } from '../../../features/branches/branchesApi';
import { useBranchScopeStore } from '../../../store/branchScopeStore';

type Op = 'movements' | 'waste' | 'counts' | 'transfers';

// Operasyon groups the four dense day-to-day admin screens behind a small
// labeled inner switcher (the only tab with a second level, by design).
export default function OperationsTab() {
  const { t } = useTranslation('stock');
  const [op, setOp] = useState<Op>('movements');
  const ops = [
    { id: 'movements' as const, label: t('tabs.movements'), icon: ArrowRightLeft },
    { id: 'waste' as const, label: t('tabs.waste'), icon: Trash2 },
    { id: 'counts' as const, label: t('tabs.stockCount'), icon: ClipboardCheck },
    { id: 'transfers' as const, label: t('sections.transfers'), icon: Building2 },
  ];
  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-xl bg-slate-100 p-1">
        {ops.map((o) => (
          <button
            key={o.id}
            onClick={() => setOp(o.id)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              op === o.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <o.icon className="h-4 w-4" />
            {o.label}
          </button>
        ))}
      </div>
      {op === 'movements' && <MovementsTab />}
      {op === 'waste' && <WasteLogTab />}
      {op === 'counts' && <StockCountsTab />}
      {op === 'transfers' && <TransfersTab />}
    </div>
  );
}

// ── Transfers section, lifted verbatim from PurchasingPage.tsx ──

function TransfersTab() {
  const { data, isLoading, isError, error, refetch } = useStockTransfers();
  const complete = useCompleteStockTransfer();
  const cancel = useCancelStockTransfer();
  const busy = complete.isPending || cancel.isPending;
  const onErr = () => toast.error('Transfer işlemi başarısız — sayfayı yenileyip tekrar deneyin.');
  if (isLoading) return <Loading />;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
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
  const isWildcard = useBranchScopeStore((s) => s.isWildcard);
  const { data: branches } = useListBranches();
  const { data: sourceItems } = useStockItems();
  const [toBranchId, setToBranchId] = useState('');
  const { data: destItems, isError: destError } = useBranchStockItems(toBranchId || undefined);
  const [sourceStockItemId, setSource] = useState('');
  const [destStockItemId, setDest] = useState('');
  const [qty, setQty] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const create = useCreateStockTransfer();

  // Only ACTIVE branches the caller is authorized for. Wildcard (ADMIN +
  // empty allow-list) is authorized for all of them — the backend
  // enforces the same rule; filtering here just avoids offering targets
  // that would dead-end at the dest-item fetch. A non-ADMIN with an
  // empty allow-list is NOT wildcard (data bug, not intentional
  // all-access), so it correctly yields zero targets.
  const targets = (branches ?? []).filter(
    (b: any) =>
      b.id !== myBranchId &&
      (b.status == null || b.status === 'active') &&
      (isWildcard || allowedBranchIds.includes(b.id))
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

// ── shared bits (lifted from PurchasingPage.tsx) ──
function Loading() {
  return <div className="py-12 text-center text-slate-400">Yükleniyor…</div>;
}
function Empty({ text }: { text: string }) {
  return <div className="py-8 text-center text-slate-400">{text}</div>;
}
function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-700',
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    CANCELLED: 'bg-slate-100 text-slate-500',
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs ${map[status] ?? 'bg-slate-100'}`}>{status}</span>;
}
