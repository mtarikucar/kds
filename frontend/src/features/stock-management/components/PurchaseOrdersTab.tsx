import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Eye, Send, PackageCheck, XCircle, X, Trash2 } from 'lucide-react';
import {
  usePurchaseOrders, useCreatePurchaseOrder, useSubmitPurchaseOrder,
  useReceivePurchaseOrder, useCancelPurchaseOrder, useSuppliers, useStockItems,
} from '../stockManagementApi';
import { PurchaseOrderStatus, type PurchaseOrder } from '../types';

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SUBMITTED: 'bg-blue-100 text-blue-700',
  PARTIALLY_RECEIVED: 'bg-yellow-100 text-yellow-700',
  RECEIVED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

const PurchaseOrdersTab = () => {
  const { t } = useTranslation('stock');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [receiveOrder, setReceiveOrder] = useState<PurchaseOrder | null>(null);
  const [viewOrder, setViewOrder] = useState<PurchaseOrder | null>(null);

  const { data: orders = [], isLoading } = usePurchaseOrders(statusFilter || undefined);
  const { data: suppliers = [] } = useSuppliers();
  const { data: stockItems = [] } = useStockItems();
  const createMutation = useCreatePurchaseOrder();
  const submitMutation = useSubmitPurchaseOrder();
  const receiveMutation = useReceivePurchaseOrder();
  const cancelMutation = useCancelPurchaseOrder();

  const statusLabel = (status: string) => t(`purchaseOrders.status${status.charAt(0) + status.slice(1).toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">{t('common.all')}</option>
          {Object.values(PurchaseOrderStatus).map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          {t('purchaseOrders.create')}
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">{t('common.loading')}</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 text-gray-500">{t('purchaseOrders.noPOs')}</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('purchaseOrders.orderNumber')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('purchaseOrders.supplier')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('purchaseOrders.status')}</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">{t('purchaseOrders.expectedDate')}</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">{t('purchaseOrders.items')}</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{order.orderNumber}</td>
                  <td className="px-4 py-3 text-gray-600">{order.supplier?.name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[order.status] || ''}`}>
                      {statusLabel(order.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{order.expectedDate ? new Date(order.expectedDate).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{order.items?.length || 0}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setViewOrder(order)} className="p-1 text-gray-400 hover:text-blue-600" title="View">
                        <Eye className="h-4 w-4" />
                      </button>
                      {order.status === 'DRAFT' && (
                        <button onClick={() => submitMutation.mutate(order.id)} className="p-1 text-gray-400 hover:text-blue-600" title={t('purchaseOrders.submit')}>
                          <Send className="h-4 w-4" />
                        </button>
                      )}
                      {(order.status === 'SUBMITTED' || order.status === 'PARTIALLY_RECEIVED') && (
                        <button onClick={() => setReceiveOrder(order)} className="p-1 text-gray-400 hover:text-emerald-600" title={t('purchaseOrders.receive')}>
                          <PackageCheck className="h-4 w-4" />
                        </button>
                      )}
                      {order.status !== 'RECEIVED' && order.status !== 'CANCELLED' && (
                        <button onClick={() => cancelMutation.mutate(order.id)} className="p-1 text-gray-400 hover:text-red-600" title={t('purchaseOrders.cancel')}>
                          <XCircle className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create PO Modal */}
      {showForm && (
        <CreatePOForm
          suppliers={suppliers}
          stockItems={stockItems}
          onSave={async (data: any) => { await createMutation.mutateAsync(data); setShowForm(false); }}
          onClose={() => setShowForm(false)}
          isLoading={createMutation.isPending}
          t={t}
        />
      )}

      {/* View PO Modal */}
      {viewOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{viewOrder.orderNumber}</h3>
              <button onClick={() => setViewOrder(null)} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-2 text-sm mb-4">
              <p><span className="text-gray-500">{t('purchaseOrders.supplier')}:</span> {viewOrder.supplier?.name}</p>
              <p><span className="text-gray-500">{t('purchaseOrders.status')}:</span> {statusLabel(viewOrder.status)}</p>
              {viewOrder.expectedDate && <p><span className="text-gray-500">{t('purchaseOrders.expectedDate')}:</span> {new Date(viewOrder.expectedDate).toLocaleDateString()}</p>}
              {viewOrder.notes && <p><span className="text-gray-500">{t('suppliers.notes')}:</span> {viewOrder.notes}</p>}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-gray-500">{t('movements.item')}</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">{t('purchaseOrders.quantityOrdered')}</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">{t('purchaseOrders.quantityReceived')}</th>
                  <th className="text-right px-3 py-2 font-medium text-gray-500">{t('purchaseOrders.unitPrice')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {viewOrder.items?.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2 text-gray-900">{item.stockItem?.name}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{item.quantityOrdered}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{item.quantityReceived}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{Number(item.unitPrice).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Receive PO Modal */}
      {receiveOrder && (
        <ReceivePOForm
          order={receiveOrder}
          onSave={async (data: any) => { await receiveMutation.mutateAsync({ id: receiveOrder.id, data }); setReceiveOrder(null); }}
          onClose={() => setReceiveOrder(null)}
          isLoading={receiveMutation.isPending}
          t={t}
        />
      )}
    </div>
  );
};

function CreatePOForm({ suppliers, stockItems, onSave, onClose, isLoading, t }: any) {
  const [form, setForm] = useState({
    supplierId: '',
    notes: '',
    expectedDate: '',
    items: [{ stockItemId: '', quantityOrdered: 0, unitPrice: 0 }],
  });

  const addItem = () => setForm({ ...form, items: [...form.items, { stockItemId: '', quantityOrdered: 0, unitPrice: 0 }] });
  const removeItem = (i: number) => setForm({ ...form, items: form.items.filter((_, idx) => idx !== i) });
  const updateItem = (i: number, field: string, value: any) => {
    const items = [...form.items];
    items[i] = { ...items[i], [field]: value };
    setForm({ ...form, items });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      supplierId: form.supplierId,
      notes: form.notes || undefined,
      expectedDate: form.expectedDate || undefined,
      items: form.items.filter((i) => i.stockItemId),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">{t('purchaseOrders.create')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('purchaseOrders.supplier')} *</label>
            <select required value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">—</option>
              {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('purchaseOrders.expectedDate')}</label>
            <input type="date" value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">{t('purchaseOrders.items')}</label>
              <button type="button" onClick={addItem} className="text-sm text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
                <Plus className="h-3 w-3" /> {t('purchaseOrders.addItem')}
              </button>
            </div>
            <div className="space-y-2">
              {form.items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select value={item.stockItemId} onChange={(e) => updateItem(idx, 'stockItemId', e.target.value)} className="flex-1 border rounded-lg px-3 py-2 text-sm">
                    <option value="">—</option>
                    {stockItems.map((si: any) => <option key={si.id} value={si.id}>{si.name}</option>)}
                  </select>
                  <input type="number" step="0.001" placeholder={t('purchaseOrders.quantityOrdered')} value={item.quantityOrdered || ''} onChange={(e) => updateItem(idx, 'quantityOrdered', parseFloat(e.target.value) || 0)} className="w-20 border rounded-lg px-3 py-2 text-sm" />
                  <input type="number" step="0.01" placeholder={t('purchaseOrders.unitPrice')} value={item.unitPrice || ''} onChange={(e) => updateItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)} className="w-20 border rounded-lg px-3 py-2 text-sm" />
                  {form.items.length > 1 && (
                    <button type="button" onClick={() => removeItem(idx)} className="p-1 text-red-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('suppliers.notes')}</label>
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

function ReceivePOForm({ order, onSave, onClose, isLoading, t }: any) {
  const [lines, setLines] = useState(
    order.items.map((item: any) => ({
      purchaseOrderItemId: item.id,
      quantityReceived: 0,
      batchNumber: '',
      expiryDate: '',
    }))
  );

  const updateLine = (i: number, field: string, value: any) => {
    const updated = [...lines];
    updated[i] = { ...updated[i], [field]: value };
    setLines(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      items: lines.filter((l: any) => l.quantityReceived > 0).map((l: any) => ({
        ...l,
        expiryDate: l.expiryDate || undefined,
        batchNumber: l.batchNumber || undefined,
      })),
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">{t('purchaseOrders.receiveItems')} — {order.orderNumber}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {order.items.map((item: any, idx: number) => (
            <div key={item.id} className="border rounded-lg p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-gray-900">{item.stockItem?.name}</span>
                <span className="text-gray-500">{t('purchaseOrders.quantityOrdered')}: {item.quantityOrdered} | {t('purchaseOrders.quantityReceived')}: {item.quantityReceived}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('movements.quantity')}</label>
                  <input type="number" step="0.001" value={lines[idx]?.quantityReceived || ''} onChange={(e) => updateLine(idx, 'quantityReceived', parseFloat(e.target.value) || 0)} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('purchaseOrders.batchNumber')}</label>
                  <input value={lines[idx]?.batchNumber || ''} onChange={(e) => updateLine(idx, 'batchNumber', e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('purchaseOrders.expiryDate')}</label>
                  <input type="date" value={lines[idx]?.expiryDate || ''} onChange={(e) => updateLine(idx, 'expiryDate', e.target.value)} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
                </div>
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">{t('common.cancel')}</button>
            <button type="submit" disabled={isLoading} className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">{t('purchaseOrders.receive')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PurchaseOrdersTab;
