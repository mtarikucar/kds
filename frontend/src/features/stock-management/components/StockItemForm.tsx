import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Check, Edit2, Trash2, Settings2 } from 'lucide-react';
import { StockUnit, type StockItem, type StockItemCategory } from '../types';
import { useStockCategories, useCreateStockCategory, useUpdateStockCategory, useDeleteStockCategory } from '../stockManagementApi';

interface Props {
  item: StockItem | null;
  onSave: (data: any) => void;
  onClose: () => void;
  isLoading: boolean;
}

const PRESET_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

type CategoryMode = 'idle' | 'create' | 'manage' | 'edit';

const StockItemForm = ({ item, onSave, onClose, isLoading }: Props) => {
  const { t } = useTranslation('stock');
  const { data: categories = [] } = useStockCategories();
  const createCategoryMutation = useCreateStockCategory();
  const updateCategoryMutation = useUpdateStockCategory();
  const deleteCategoryMutation = useDeleteStockCategory();

  const [form, setForm] = useState({
    name: item?.name || '',
    sku: item?.sku || '',
    unit: item?.unit || StockUnit.KG,
    description: item?.description || '',
    currentStock: item ? Number(item.currentStock) : 0,
    minStock: item ? Number(item.minStock) : 0,
    costPerUnit: item ? Number(item.costPerUnit) : 0,
    trackExpiry: item?.trackExpiry || false,
    categoryId: item?.categoryId || '',
    isActive: item?.isActive ?? true,
  });

  const [categoryMode, setCategoryMode] = useState<CategoryMode>('idle');
  const [editingCategory, setEditingCategory] = useState<StockItemCategory | null>(null);
  const [catName, setCatName] = useState('');
  const [catColor, setCatColor] = useState(PRESET_COLORS[0]);

  const resetCategoryForm = () => {
    setCategoryMode('idle');
    setEditingCategory(null);
    setCatName('');
    setCatColor(PRESET_COLORS[0]);
  };

  const startCreate = () => {
    setCategoryMode('create');
    setEditingCategory(null);
    setCatName('');
    setCatColor(PRESET_COLORS[0]);
  };

  const startEdit = (cat: StockItemCategory) => {
    setCategoryMode('edit');
    setEditingCategory(cat);
    setCatName(cat.name);
    setCatColor(cat.color || PRESET_COLORS[0]);
  };

  const toggleManage = () => {
    if (categoryMode === 'manage') {
      resetCategoryForm();
    } else {
      setCategoryMode('manage');
      setEditingCategory(null);
      setCatName('');
      setCatColor(PRESET_COLORS[0]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ ...form, categoryId: form.categoryId || undefined });
  };

  const handleSaveCategory = async () => {
    if (!catName.trim()) return;
    try {
      if (categoryMode === 'create') {
        const created = await createCategoryMutation.mutateAsync({
          name: catName.trim(),
          color: catColor,
        });
        setForm({ ...form, categoryId: created.id });
        resetCategoryForm();
      } else if (categoryMode === 'edit' && editingCategory) {
        await updateCategoryMutation.mutateAsync({
          id: editingCategory.id,
          data: { name: catName.trim(), color: catColor },
        });
        setCategoryMode('manage');
        setEditingCategory(null);
        setCatName('');
        setCatColor(PRESET_COLORS[0]);
      }
    } catch {
      // error handled by mutation's onError
    }
  };

  const handleDeleteCategory = async (cat: StockItemCategory) => {
    if (!window.confirm(t('categories.confirmDelete'))) return;
    try {
      await deleteCategoryMutation.mutateAsync(cat.id);
      if (form.categoryId === cat.id) {
        setForm({ ...form, categoryId: '' });
      }
    } catch {
      // error handled by mutation's onError
    }
  };

  const isSaving = createCategoryMutation.isPending || updateCategoryMutation.isPending;
  const showCategoryForm = categoryMode === 'create' || categoryMode === 'edit';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">{item ? t('items.edit') : t('items.create')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('items.name')} *</label>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('items.sku')}</label>
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('items.unit')} *</label>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as StockUnit })} className="w-full border rounded-lg px-3 py-2 text-sm">
                {Object.values(StockUnit).map((u) => (
                  <option key={u} value={u}>{t(`units.${u}`)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Category section */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">{t('items.category')}</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={startCreate}
                  className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  <Plus className="h-3 w-3" />
                  {t('categories.create')}
                </button>
                {categories.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleManage}
                    className={`flex items-center gap-1 text-xs font-medium ${
                      categoryMode === 'manage' ? 'text-blue-700' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Settings2 className="h-3 w-3" />
                    {t('categories.manage')}
                  </button>
                )}
              </div>
            </div>
            <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">—</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>

            {/* Inline create / edit form */}
            {showCategoryForm && (
              <div className="mt-2 p-3 border border-emerald-200 rounded-lg bg-emerald-50/50 space-y-2">
                <p className="text-xs font-medium text-emerald-700">
                  {categoryMode === 'create' ? t('categories.create') : t('categories.editCategory')}
                </p>
                <div className="flex gap-2">
                  <input
                    autoFocus
                    placeholder={t('categories.name')}
                    value={catName}
                    onChange={(e) => setCatName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleSaveCategory(); }
                      if (e.key === 'Escape') resetCategoryForm();
                    }}
                    className="flex-1 border rounded-lg px-3 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCategory}
                    disabled={!catName.trim() || isSaving}
                    className="p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={resetCategoryForm}
                    className="p-1.5 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setCatColor(color)}
                      className={`h-5 w-5 rounded-full border-2 ${catColor === color ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Manage categories list */}
            {categoryMode === 'manage' && (
              <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                {categories.map((cat) => (
                  <div key={cat.id} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50">
                    <div className="flex items-center gap-2 min-w-0">
                      {cat.color && (
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                      )}
                      <span className="text-sm text-gray-700 truncate">{cat.name}</span>
                      {cat._count && (
                        <span className="text-xs text-gray-400 shrink-0">({cat._count.stockItems})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(cat)}
                        className="p-1 text-gray-400 hover:text-blue-600"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(cat)}
                        className="p-1 text-gray-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('items.currentStock')}</label>
              <input type="number" step="0.001" value={form.currentStock} onChange={(e) => setForm({ ...form, currentStock: parseFloat(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('items.minStock')}</label>
              <input type="number" step="0.001" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: parseFloat(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('items.costPerUnit')}</label>
              <input type="number" step="0.0001" value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: parseFloat(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.trackExpiry} onChange={(e) => setForm({ ...form, trackExpiry: e.target.checked })} className="rounded" />
              {t('items.trackExpiry')}
            </label>
            {item && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="rounded" />
                {t('items.active')}
              </label>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('items.description')}</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">{t('common.cancel')}</button>
            <button type="submit" disabled={isLoading} className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
              {t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default StockItemForm;
