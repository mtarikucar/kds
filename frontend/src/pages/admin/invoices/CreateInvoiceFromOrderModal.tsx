import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FilePlus2 } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import { useOrders } from '../../../features/orders/ordersApi';
import {
  useCreateInvoiceFromOrder,
} from '../../../features/accounting/accountingApi';
import type { SalesInvoice } from '../../../features/accounting/types';
import { getApiErrorMessage } from '../../../lib/api-error';

const TAX_ID_RE = /^\d{10,11}$/;

const formatCurrency = (amount: number | string) =>
  Number(amount).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });

interface Props {
  onClose: () => void;
  onCreated: (invoice: SalesInvoice) => void;
}

/**
 * D1 — manual fatura issuance for a PAID order. Two-part flow inside one
 * modal: pick the paid order, optionally fill the buyer's VKN/TCKN + vergi
 * dairesi + unvan (everything CreateSalesInvoiceDto accepts for identity),
 * confirm. The parent invalidates + highlights the new invoice.
 */
export default function CreateInvoiceFromOrderModal({ onClose, onCreated }: Props) {
  const { t } = useTranslation('settings');
  // Recent PAID orders — the only ones the backend will invoice.
  const { data: orders, isLoading, isError } = useOrders({ status: 'PAID', limit: 50 });
  const createInvoice = useCreateInvoiceFromOrder();

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerTaxId, setCustomerTaxId] = useState('');
  const [customerTaxOffice, setCustomerTaxOffice] = useState('');

  const taxIdInvalid = customerTaxId !== '' && !TAX_ID_RE.test(customerTaxId);

  const handleSubmit = async () => {
    if (!selectedOrderId || taxIdInvalid) return;
    try {
      const invoice = await createInvoice.mutateAsync({
        orderId: selectedOrderId,
        ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
        ...(customerTaxId ? { customerTaxId } : {}),
        ...(customerTaxOffice.trim() ? { customerTaxOffice: customerTaxOffice.trim() } : {}),
      });
      toast.success(t('accounting.createInvoiceModal.created'));
      onCreated(invoice);
    } catch (e: any) {
      toast.error(getApiErrorMessage(e, t('accounting.createInvoiceModal.createError')));
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={t('accounting.createInvoiceModal.title')} size="lg">
      <div className="space-y-5">
        {/* Step 1 — paid-order picker */}
        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">
            {t('accounting.createInvoiceModal.selectOrder')}
          </p>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-slate-500">
              {t('accounting.loading')}
            </div>
          ) : isError ? (
            <div className="py-8 text-center text-sm text-red-600">
              {t('accounting.createInvoiceModal.ordersLoadError')}
            </div>
          ) : !orders || orders.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              {t('accounting.createInvoiceModal.noPaidOrders')}
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
              {orders.map((order) => (
                <label
                  key={order.id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50 ${
                    selectedOrderId === order.id ? 'bg-primary-50' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="invoice-order"
                    checked={selectedOrderId === order.id}
                    onChange={() => setSelectedOrderId(order.id)}
                    className="accent-primary-600"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-slate-900 truncate">
                      #{order.orderNumber}
                      {order.customerName ? ` — ${order.customerName}` : ''}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {new Date(order.createdAt).toLocaleString('tr-TR')}
                    </span>
                  </span>
                  <span className="text-sm font-medium text-slate-900 whitespace-nowrap">
                    {formatCurrency(order.finalAmount)}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Step 2 — optional buyer identity (falls back to the order's own values) */}
        <div>
          <p className="text-sm font-medium text-slate-700 mb-1">
            {t('accounting.createInvoiceModal.optionalFields')}
          </p>
          <p className="text-xs text-slate-500 mb-3">
            {t('accounting.createInvoiceModal.optionalFieldsHint')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {t('accounting.createInvoiceModal.customerName')}
              </label>
              <input
                type="text"
                value={customerName}
                maxLength={200}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {t('accounting.createInvoiceModal.customerTaxId')}
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={customerTaxId}
                maxLength={11}
                onChange={(e) => setCustomerTaxId(e.target.value.replace(/\D/g, ''))}
                aria-invalid={taxIdInvalid}
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 ${
                  taxIdInvalid
                    ? 'border-red-400 focus:ring-red-400'
                    : 'border-slate-300 focus:ring-primary-500'
                }`}
              />
              {taxIdInvalid && (
                <p className="mt-1 text-xs text-red-600">{t('accounting.taxIdError')}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {t('accounting.createInvoiceModal.customerTaxOffice')}
              </label>
              <input
                type="text"
                value={customerTaxOffice}
                maxLength={120}
                onChange={(e) => setCustomerTaxOffice(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        </div>

        {/* Confirm */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-lg"
          >
            {t('accounting.createInvoiceModal.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedOrderId || taxIdInvalid || createInvoice.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FilePlus2 className="w-4 h-4" />
            {createInvoice.isPending
              ? t('accounting.createInvoiceModal.creating')
              : t('accounting.createInvoiceModal.submit')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
