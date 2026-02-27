import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Edit2, Trash2, AlertTriangle } from 'lucide-react';
import { useStockItems, useStockCategories, useCreateStockItem, useUpdateStockItem, useDeleteStockItem } from '../stockManagementApi';
import { StockUnit, type StockItem } from '../types';
import StockItemForm from './StockItemForm';

const StockItemsTab = () => {
  const { t } = useTranslation('stock');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<StockItem | null>(null);

  const { data: items = [], isLoading } = useStockItems({ search: search || undefined, categoryId: categoryFilter || undefined });
  const { data: categories = [] } = useStockCategories();
  const createMutation = useCreateStockItem();
  const updateMutation = useUpdateStockItem();
  const deleteMutation = useDeleteStockItem();

  const handleSave = async (data: any) => {
    if (editItem) {
      await updateMutation.mutateAsync({ id: editItem.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
    setShowForm(false);
    setEditItem(null);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t('items.confirmDelete'))) {
      await deleteMutation.mutateAsync(id);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-3 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder={t('items.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">{t('common.all')}</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => { setEditItem(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          {t('items.create')}
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">{t('common.loading')}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-500">{t('items.noItems')}</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('items.name')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('items.sku')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('items.category')}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">{t('items.currentStock')}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">{t('items.minStock')}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">{t('items.costPerUnit')}</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => {
                const isLow = Number(item.currentStock) <= Number(item.minStock);
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 flex items-center gap-2">
                      {item.name}
                      {isLow && <AlertTriangle className="h-4 w-4 text-red-500" />}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{item.sku || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{item.category?.name || '—'}</td>
                    <td className={`px-4 py-3 text-right font-medium ${isLow ? 'text-red-600' : 'text-gray-900'}`}>
                      {Number(item.currentStock).toFixed(1)} {t(`units.${item.unit}`)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{Number(item.minStock).toFixed(1)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{Number(item.costPerUnit).toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => { setEditItem(item); setShowForm(true); }} className="p-1 text-gray-400 hover:text-blue-600">
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(item.id)} className="p-1 text-gray-400 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <StockItemForm
          item={editItem}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditItem(null); }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}
    </div>
  );
};

export default StockItemsTab;
