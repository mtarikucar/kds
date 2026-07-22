import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useSuppliers,
  useSupplier,
  useStockItems,
  useAddSupplierItem,
  useRemoveSupplierItem,
} from '../stockManagementApi';

// Supplier price catalog: pick a supplier, see/edit its linked stock items
// (supplierSku, unitPrice, preferred). Feeds the Purchasing Guide's CATALOG
// price source (see `guide.catalogPrice` in the guidance section above).
const SupplierCatalog = () => {
  const { t } = useTranslation('stock');
  const { data: suppliers, isLoading: suppliersLoading } = useSuppliers();
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  const supplierId = selectedSupplierId ?? suppliers?.[0]?.id ?? null;
  const { data: supplier } = useSupplier(supplierId ?? '');
  const { data: stockItems } = useStockItems();

  const addItem = useAddSupplierItem();
  const removeItem = useRemoveSupplierItem();

  const [newStockItemId, setNewStockItemId] = useState('');
  const [newSku, setNewSku] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newPreferred, setNewPreferred] = useState(false);

  const linkedItems = supplier?.supplierStockItems ?? [];
  const linkedIds = new Set(linkedItems.map((i) => i.stockItemId));
  const availableItems = (stockItems ?? []).filter((i) => !linkedIds.has(i.id));

  const handleSelectSupplier = (id: string) => {
    setSelectedSupplierId(id);
    setNewStockItemId('');
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || !newStockItemId || !newPrice) return;
    addItem.mutate(
      {
        supplierId,
        data: {
          stockItemId: newStockItemId,
          unitPrice: Number(newPrice),
          supplierSku: newSku || undefined,
          isPreferred: newPreferred,
        },
      },
      {
        onSuccess: () => {
          setNewStockItemId('');
          setNewSku('');
          setNewPrice('');
          setNewPreferred(false);
        },
      },
    );
  };

  const handleRemove = (stockItemId: string) => {
    if (!supplierId) return;
    removeItem.mutate({ supplierId, stockItemId });
  };

  if (suppliersLoading) {
    return <div className="text-center py-8 text-slate-400">{t('common.loading')}</div>;
  }

  if (!suppliers || suppliers.length === 0) {
    return <div className="text-center py-8 text-slate-400">{t('suppliers.noSuppliers')}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('suppliers.catalog.selectSupplier')}
        </label>
        <select
          value={supplierId ?? ''}
          onChange={(e) => handleSelectSupplier(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-500">{t('suppliers.catalog.item')}</th>
              <th className="text-left px-4 py-2 font-medium text-gray-500">{t('suppliers.catalog.supplierSku')}</th>
              <th className="text-right px-4 py-2 font-medium text-gray-500">{t('suppliers.catalog.price')}</th>
              <th className="text-center px-4 py-2 font-medium text-gray-500">{t('suppliers.catalog.preferred')}</th>
              <th className="text-center px-4 py-2 font-medium text-gray-500">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {linkedItems.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-6 text-gray-400">{t('suppliers.catalog.noItems')}</td>
              </tr>
            ) : (
              linkedItems.map((item) => (
                <tr key={item.stockItemId} className="border-t border-gray-100">
                  <td className="px-4 py-2">{item.stockItem?.name}</td>
                  <td className="px-4 py-2">{item.supplierSku}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{item.unitPrice}</td>
                  <td className="px-4 py-2 text-center">
                    {item.isPreferred && (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs">
                        {t('suppliers.catalog.preferred')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      type="button"
                      data-testid={`remove-${item.stockItemId}`}
                      onClick={() => handleRemove(item.stockItemId)}
                      disabled={removeItem.isPending}
                      className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                    >
                      {t('suppliers.catalog.remove')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3 pt-2 border-t border-gray-100">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('suppliers.catalog.selectItem')}</label>
          <select
            value={newStockItemId}
            onChange={(e) => setNewStockItemId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">{t('suppliers.catalog.selectItem')}</option>
            {availableItems.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('suppliers.catalog.supplierSku')}</label>
          <input
            value={newSku}
            onChange={(e) => setNewSku(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-28"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('suppliers.catalog.price')}</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-24"
          />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2">
          <input
            type="checkbox"
            checked={newPreferred}
            onChange={(e) => setNewPreferred(e.target.checked)}
            className="rounded"
          />
          {t('suppliers.catalog.preferred')}
        </label>
        <button
          type="submit"
          disabled={!newStockItemId || !newPrice || addItem.isPending}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          {t('suppliers.catalog.addLink')}
        </button>
      </form>
    </div>
  );
};

export default SupplierCatalog;
