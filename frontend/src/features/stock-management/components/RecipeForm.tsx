import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Plus, Trash2 } from 'lucide-react';
import { useStockItems } from '../stockManagementApi';
import { type Recipe } from '../types';
import api from '../../../lib/api';

interface Props {
  recipe: Recipe | null;
  onSave: (data: any) => void;
  onClose: () => void;
  isLoading: boolean;
}

const RecipeForm = ({ recipe, onSave, onClose, isLoading }: Props) => {
  const { t } = useTranslation('stock');
  const { data: stockItems = [] } = useStockItems();
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({
    productId: recipe?.productId || '',
    name: recipe?.name || '',
    notes: recipe?.notes || '',
    yield: recipe?.yield || 1,
    ingredients: recipe?.ingredients.map((i) => ({
      stockItemId: i.stockItemId,
      quantity: Number(i.quantity),
    })) || [{ stockItemId: '', quantity: 0 }],
  });

  useEffect(() => {
    api.get('/menu/products').then((res) => setProducts(res.data)).catch(() => {});
  }, []);

  const addIngredient = () => {
    setForm({ ...form, ingredients: [...form.ingredients, { stockItemId: '', quantity: 0 }] });
  };

  const removeIngredient = (index: number) => {
    setForm({ ...form, ingredients: form.ingredients.filter((_, i) => i !== index) });
  };

  const updateIngredient = (index: number, field: string, value: any) => {
    const updated = [...form.ingredients];
    updated[index] = { ...updated[index], [field]: value };
    setForm({ ...form, ingredients: updated });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: any = {
      name: form.name || undefined,
      notes: form.notes || undefined,
      yield: form.yield,
      ingredients: form.ingredients.filter((i) => i.stockItemId),
    };
    if (!recipe) data.productId = form.productId;
    onSave(data);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">{recipe ? t('recipes.edit') : t('recipes.create')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {!recipe && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('recipes.product')} *</label>
              <select required value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">{t('recipes.selectProduct')}</option>
                {products.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('recipes.name')}</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('recipes.yield')}</label>
              <input type="number" min={1} value={form.yield} onChange={(e) => setForm({ ...form, yield: parseInt(e.target.value) || 1 })} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">{t('recipes.ingredients')}</label>
              <button type="button" onClick={addIngredient} className="text-sm text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
                <Plus className="h-3 w-3" /> {t('recipes.addIngredient')}
              </button>
            </div>
            <div className="space-y-2">
              {form.ingredients.map((ing, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={ing.stockItemId}
                    onChange={(e) => updateIngredient(idx, 'stockItemId', e.target.value)}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">—</option>
                    {stockItems.map((si) => (
                      <option key={si.id} value={si.id}>{si.name} ({t(`units.${si.unit}`)})</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.001"
                    placeholder={t('recipes.quantity')}
                    value={ing.quantity || ''}
                    onChange={(e) => updateIngredient(idx, 'quantity', parseFloat(e.target.value) || 0)}
                    className="w-24 border rounded-lg px-3 py-2 text-sm"
                  />
                  {form.ingredients.length > 1 && (
                    <button type="button" onClick={() => removeIngredient(idx)} className="p-1 text-red-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('recipes.notes')}</label>
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
};

export default RecipeForm;
