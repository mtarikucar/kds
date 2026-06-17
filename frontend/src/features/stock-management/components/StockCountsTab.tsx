import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Eye, CheckCircle, XCircle, X } from 'lucide-react';
import {
  useStockCounts, useStockCount, useCreateStockCount,
  useUpdateStockCountItem, useFinalizeStockCount, useCancelStockCount,
} from '../stockManagementApi';
import { StockCountStatus, type StockCount } from '../types';
import Modal from '../../../components/ui/Modal';

const statusColors: Record<string, string> = {
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

const StockCountsTab = () => {
  const { t } = useTranslation('stock');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [activeCountId, setActiveCountId] = useState<string | null>(null);

  const { data: counts = [], isLoading } = useStockCounts(statusFilter || undefined);
  const createMutation = useCreateStockCount();
  const finalizeMutation = useFinalizeStockCount();
  const cancelMutation = useCancelStockCount();

  const statusLabel = (status: string) => t(`counts.status${status.charAt(0) + status.slice(1).toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`);

  const handleCreate = async (data: any) => {
    const result = await createMutation.mutateAsync(data);
    setShowCreate(false);
    setActiveCountId(result.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">{t('common.all')}</option>
          {Object.values(StockCountStatus).map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          {t('counts.create')}
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">{t('common.loading')}</div>
      ) : counts.length === 0 ? (
        <div className="text-center py-12 text-gray-500">{t('counts.noCounts')}</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('counts.name')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('counts.status')}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">{t('counts.items')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('movements.date')}</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {counts.map((count) => (
                <tr key={count.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{count.name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[count.status] || ''}`}>
                      {statusLabel(count.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{count._count?.items || count.items?.length || 0}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(count.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setActiveCountId(count.id)} className="p-1 text-gray-400 hover:text-blue-600" title="View">
                        <Eye className="h-4 w-4" />
                      </button>
                      {count.status === 'IN_PROGRESS' && (
                        // deep-review FL4: confirm + pending-guard the inventory-mutating finalize/cancel against accidental and double clicks
                        <>
                          <button
                            onClick={() => { if (window.confirm(t('counts.confirmFinalize', { defaultValue: 'Finalize this stock count? Counted quantities will be committed as inventory adjustments and this cannot be undone.' }))) finalizeMutation.mutate(count.id); }}
                            disabled={finalizeMutation.isPending || cancelMutation.isPending}
                            className="p-1 text-gray-400 hover:text-emerald-600 disabled:opacity-50 disabled:pointer-events-none"
                            title={t('counts.finalize')}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => { if (window.confirm(t('counts.confirmCancel', { defaultValue: 'Cancel this stock count? This cannot be undone.' }))) cancelMutation.mutate(count.id); }}
                            disabled={finalizeMutation.isPending || cancelMutation.isPending}
                            className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-50 disabled:pointer-events-none"
                            title={t('counts.cancel')}
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateCountForm
          onSave={handleCreate}
          onClose={() => setShowCreate(false)}
          isLoading={createMutation.isPending}
          t={t}
        />
      )}

      {activeCountId && (
        <StockCountSession
          countId={activeCountId}
          onClose={() => setActiveCountId(null)}
        />
      )}
    </div>
  );
};

function CreateCountForm({ onSave, onClose, isLoading, t }: any) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name: name || undefined, notes: notes || undefined });
  };

  return (
    <Modal isOpen onClose={onClose} title={t('counts.create')} size="sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('counts.name')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly Count" className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('waste.notes')}</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">{t('common.cancel')}</button>
            <button type="submit" disabled={isLoading} className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">{t('counts.create')}</button>
          </div>
        </form>
    </Modal>
  );
}

function StockCountSession({ countId, onClose }: { countId: string; onClose: () => void }) {
  const { t } = useTranslation('stock');
  const { data: count, isLoading } = useStockCount(countId);
  const updateItemMutation = useUpdateStockCountItem();
  const finalizeMutation = useFinalizeStockCount();

  if (isLoading || !count) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 text-center text-gray-500">
          {t('common.loading')}
        </div>
      </div>
    );
  }

  const countedCount = count.items.filter((i) => i.countedQty != null).length;
  const allCounted = countedCount === count.items.length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-lg font-semibold">{count.name || t('counts.title')}</h2>
            <p className="text-sm text-gray-500">
              {countedCount}/{count.items.length} {t('counts.items')}
              {allCounted ? ` — ${t('counts.allItemsCounted')}` : ` — ${count.items.length - countedCount} ${t('counts.uncountedItems')}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {count.status === 'IN_PROGRESS' && allCounted && (
              <button
                // deep-review FL4: confirm + pending-guard the session-modal finalize too
                onClick={() => { if (window.confirm(t('counts.confirmFinalize', { defaultValue: 'Finalize this stock count? Counted quantities will be committed as inventory adjustments and this cannot be undone.' }))) { finalizeMutation.mutate(countId); onClose(); } }}
                disabled={finalizeMutation.isPending}
                className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {t('counts.finalize')}
              </button>
            )}
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="p-6">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('movements.item')}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">{t('counts.expectedQty')}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">{t('counts.countedQty')}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">{t('counts.variance')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {count.items.map((item) => {
                const variance = item.countedQty != null ? item.countedQty - item.expectedQty : null;
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {item.stockItem?.name}
                      {item.stockItem?.unit && <span className="text-gray-400 ml-1">({t(`units.${item.stockItem.unit}`)})</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{Number(item.expectedQty).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">
                      {count.status === 'IN_PROGRESS' ? (
                        <CountedQtyInput
                          committed={item.countedQty ?? null}
                          onCommit={(v) => updateItemMutation.mutate({ countId, itemId: item.id, data: { countedQty: v } })}
                        />
                      ) : (
                        <span className="text-gray-600">{item.countedQty != null ? Number(item.countedQty).toFixed(2) : '—'}</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${
                      variance == null ? 'text-gray-400' : variance === 0 ? 'text-gray-600' : variance > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {variance != null ? (variance >= 0 ? '+' : '') + variance.toFixed(2) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// deep-review FM9: decouple the count input's display value from the committed value and
// persist only on blur/Enter (not on every keystroke). This sends one PATCH per field edit
// instead of one per keystroke and eliminates mid-typing out-of-order overwrites, because the
// draft is local and only reconciles with the server value when the field is not being edited.
// NOTE: clearing the field back to "uncounted" (null) is intentionally NOT committed here — the
// updateStockCountItem mutation/endpoint only accepts `{ countedQty: number }`; supporting null
// requires a backend + API-type change (out of scope for this file).
function CountedQtyInput({ committed, onCommit }: { committed: number | null; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string>(committed != null ? String(committed) : '');
  // re-sync when the server value changes while the field isn't actively being edited
  useEffect(() => {
    setDraft(committed != null ? String(committed) : '');
  }, [committed]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === '') return; // empty -> leave as-is (cannot reset to uncounted yet)
    const next = Number.parseFloat(trimmed);
    if (Number.isNaN(next)) return; // ignore garbage
    if (next === committed) return; // no-op, avoids a redundant PATCH
    onCommit(next);
  };

  return (
    <input
      type="number"
      step="0.001"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className="w-24 border rounded-lg px-2 py-1 text-sm text-right"
      placeholder="—"
    />
  );
}

export default StockCountsTab;
