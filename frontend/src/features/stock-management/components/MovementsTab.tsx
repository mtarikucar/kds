import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { useIngredientMovements, useCreateMovement, useStockItems } from '../stockManagementApi';
import { IngredientMovementType } from '../types';

const movementTypeColors: Record<string, string> = {
  IN: 'bg-green-100 text-green-700',
  OUT: 'bg-red-100 text-red-700',
  ADJUSTMENT: 'bg-blue-100 text-blue-700',
  WASTE: 'bg-orange-100 text-orange-700',
  ORDER_DEDUCTION: 'bg-purple-100 text-purple-700',
  PO_RECEIVE: 'bg-teal-100 text-teal-700',
  COUNT_ADJUSTMENT: 'bg-yellow-100 text-yellow-700',
};

const MovementsTab = () => {
  const { t } = useTranslation('stock');
  const [typeFilter, setTypeFilter] = useState('');
  const [itemFilter, setItemFilter] = useState('');
  const [showForm, setShowForm] = useState(false);

  const { data: movements = [], isLoading } = useIngredientMovements({
    type: typeFilter || undefined,
    stockItemId: itemFilter || undefined,
  });
  const { data: stockItems = [] } = useStockItems();
  const createMutation = useCreateMovement();

  const typeLabel = (type: string) => t(`movements.type${type.charAt(0) + type.slice(1).toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-3">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
            <option value="">{t('common.all')}</option>
            {Object.values(IngredientMovementType).map((type) => (
              <option key={type} value={type}>{typeLabel(type)}</option>
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
          {t('movements.create')}
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">{t('common.loading')}</div>
      ) : movements.length === 0 ? (
        <div className="text-center py-12 text-gray-500">{t('movements.noMovements')}</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('movements.date')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('movements.item')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('movements.type')}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">{t('movements.quantity')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('movements.notes')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {movements.map((movement) => (
                <tr key={movement.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600">{new Date(movement.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{movement.stockItem?.name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${movementTypeColors[movement.type] || ''}`}>
                      {typeLabel(movement.type)}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${Number(movement.quantity) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {Number(movement.quantity) >= 0 ? '+' : ''}{Number(movement.quantity).toFixed(3)}
                    {movement.stockItem?.unit ? ` ${t(`units.${movement.stockItem.unit}`)}` : ''}
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{movement.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <MovementForm
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

function MovementForm({ stockItems, onSave, onClose, isLoading, t }: any) {
  const [form, setForm] = useState({
    stockItemId: '',
    type: 'IN' as string,
    quantity: 0,
    costPerUnit: 0,
    notes: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...form,
      costPerUnit: form.costPerUnit || undefined,
      notes: form.notes || undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">{t('movements.create')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('movements.item')} *</label>
            <select required value={form.stockItemId} onChange={(e) => setForm({ ...form, stockItemId: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">—</option>
              {stockItems.map((si: any) => <option key={si.id} value={si.id}>{si.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('movements.type')} *</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="IN">{t('movements.typeIn')}</option>
                <option value="OUT">{t('movements.typeOut')}</option>
                <option value="ADJUSTMENT">{t('movements.typeAdjustment')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('movements.quantity')} *</label>
              <input type="number" step="0.001" required value={form.quantity || ''} onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('movements.notes')}</label>
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

export default MovementsTab;
