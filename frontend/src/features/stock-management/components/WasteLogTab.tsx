import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { useWasteLogs, useCreateWasteLog, useStockItems } from '../stockManagementApi';
import { WasteReason } from '../types';

const reasonColors: Record<string, string> = {
  EXPIRED: 'bg-red-100 text-red-700',
  SPOILED: 'bg-orange-100 text-orange-700',
  DAMAGED: 'bg-yellow-100 text-yellow-700',
  OVERPRODUCTION: 'bg-blue-100 text-blue-700',
  PREPARATION_WASTE: 'bg-purple-100 text-purple-700',
  CUSTOMER_RETURN: 'bg-pink-100 text-pink-700',
  OTHER: 'bg-gray-100 text-gray-700',
};

const WasteLogTab = () => {
  const { t } = useTranslation('stock');
  const [reasonFilter, setReasonFilter] = useState('');
  const [itemFilter, setItemFilter] = useState('');
  const [showForm, setShowForm] = useState(false);

  const { data: wasteLogs = [], isLoading } = useWasteLogs({
    reason: reasonFilter || undefined,
    stockItemId: itemFilter || undefined,
  });
  const { data: stockItems = [] } = useStockItems();
  const createMutation = useCreateWasteLog();

  const reasonLabel = (reason: string) => t(`waste.reason${reason.charAt(0) + reason.slice(1).toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-3">
          <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">{t('common.all')}</option>
            {Object.values(WasteReason).map((r) => (
              <option key={r} value={r}>{reasonLabel(r)}</option>
            ))}
          </select>
          <select value={itemFilter} onChange={(e) => setItemFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">{t('common.all')}</option>
            {stockItems.map((si) => (
              <option key={si.id} value={si.id}>{si.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          {t('waste.create')}
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">{t('common.loading')}</div>
      ) : wasteLogs.length === 0 ? (
        <div className="text-center py-12 text-gray-500">{t('waste.noWaste')}</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('movements.date')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('waste.item')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('waste.reason')}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">{t('waste.quantity')}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">{t('waste.cost')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('waste.notes')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {wasteLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{log.stockItem?.name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${reasonColors[log.reason] || ''}`}>
                      {reasonLabel(log.reason)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-red-600 font-medium">
                    -{Number(log.quantity).toFixed(3)}
                    {log.stockItem?.unit ? ` ${t(`units.${log.stockItem.unit}`)}` : ''}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{log.cost != null ? Number(log.cost).toFixed(2) : '—'}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{log.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <WasteLogForm
          stockItems={stockItems}
          onSave={async (data: any) => { await createMutation.mutateAsync(data); setShowForm(false); }}
          onClose={() => setShowForm(false)}
          isLoading={createMutation.isPending}
          t={t}
        />
      )}
    </div>
  );
};

function WasteLogForm({ stockItems, onSave, onClose, isLoading, t }: any) {
  const [form, setForm] = useState({
    stockItemId: '',
    quantity: 0,
    reason: 'SPOILED' as string,
    notes: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...form,
      notes: form.notes || undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">{t('waste.create')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('waste.item')} *</label>
            <select required value={form.stockItemId} onChange={(e) => setForm({ ...form, stockItemId: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">—</option>
              {stockItems.map((si: any) => <option key={si.id} value={si.id}>{si.name} ({t(`units.${si.unit}`)})</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('waste.quantity')} *</label>
              <input type="number" step="0.001" required value={form.quantity || ''} onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('waste.reason')} *</label>
              <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                {Object.values(WasteReason).map((r) => (
                  <option key={r} value={r}>{t(`waste.reason${r.charAt(0) + r.slice(1).toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`)}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('waste.notes')}</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">{t('common.cancel')}</button>
            <button type="submit" disabled={isLoading} className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">{t('common.save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default WasteLogTab;
