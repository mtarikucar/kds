import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Edit2, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { useRecipes, useCreateRecipe, useUpdateRecipe, useDeleteRecipe, useCheckRecipeStock } from '../stockManagementApi';
import { type Recipe } from '../types';
import RecipeForm from './RecipeForm';

const RecipesTab = () => {
  const { t } = useTranslation('stock');
  const [showForm, setShowForm] = useState(false);
  const [editRecipe, setEditRecipe] = useState<Recipe | null>(null);
  const [stockCheck, setStockCheck] = useState<any>(null);

  const { data: recipes = [], isLoading } = useRecipes();
  const createMutation = useCreateRecipe();
  const updateMutation = useUpdateRecipe();
  const deleteMutation = useDeleteRecipe();
  const checkStockMutation = useCheckRecipeStock();

  const handleSave = async (data: any) => {
    if (editRecipe) {
      await updateMutation.mutateAsync({ id: editRecipe.id, data });
    } else {
      await createMutation.mutateAsync(data);
    }
    setShowForm(false);
    setEditRecipe(null);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t('recipes.confirmDelete'))) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const handleCheckStock = async (id: string) => {
    const result = await checkStockMutation.mutateAsync({ id });
    setStockCheck(result);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('recipes.title')}</h2>
        <button
          onClick={() => { setEditRecipe(null); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          {t('recipes.create')}
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">{t('common.loading')}</div>
      ) : recipes.length === 0 ? (
        <div className="text-center py-12 text-gray-500">{t('recipes.noRecipes')}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {recipes.map((recipe) => (
            <div key={recipe.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{recipe.name || recipe.product?.name}</h3>
                  <p className="text-xs text-gray-500">{recipe.product?.name} — {t('recipes.yield')}: {recipe.yield}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleCheckStock(recipe.id)} className="p-1 text-gray-400 hover:text-emerald-600" title={t('recipes.checkStock')}>
                    <CheckCircle className="h-4 w-4" />
                  </button>
                  <button onClick={() => { setEditRecipe(recipe); setShowForm(true); }} className="p-1 text-gray-400 hover:text-blue-600">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(recipe.id)} className="p-1 text-gray-400 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {recipe.ingredients.map((ing) => (
                  <div key={ing.id} className="flex justify-between text-sm">
                    <span className="text-gray-600">{ing.stockItem?.name}</span>
                    <span className="text-gray-900">{Number(ing.quantity).toFixed(2)} {ing.stockItem?.unit ? t(`units.${ing.stockItem.unit}`) : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stock Check Result Modal */}
      {stockCheck && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{t('recipes.checkStock')}</h3>
              <button onClick={() => setStockCheck(null)} className="p-1 hover:bg-gray-100 rounded">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className={`p-3 rounded-lg mb-4 ${stockCheck.canProduce ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {stockCheck.canProduce ? t('recipes.canProduce') : t('recipes.cannotProduce')}
              <span className="ml-2 font-medium">{t('recipes.maxQuantity')}: {stockCheck.maxQuantity}</span>
            </div>
            <div className="space-y-2">
              {stockCheck.ingredients.map((ing: any) => (
                <div key={ing.stockItemId} className="flex justify-between text-sm">
                  <span className={ing.sufficient ? 'text-gray-600' : 'text-red-600 font-medium'}>{ing.name}</span>
                  <span>{ing.available.toFixed(1)} / {ing.required.toFixed(1)} {ing.unit}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <RecipeForm
          recipe={editRecipe}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditRecipe(null); }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}
    </div>
  );
};

export default RecipesTab;
