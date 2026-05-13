import { useState } from 'react';
import { FileText, Download, Eye, CheckCircle2, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { downloadInvoice } from '../../api/paymentsApi';
import InvoiceViewerModal from './InvoiceViewerModal';

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  total: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  paidAt?: string;
  createdAt: string;
}

interface InvoiceCardProps {
  invoice: Invoice;
}

export function InvoiceCard({ invoice }: InvoiceCardProps) {
  const { t } = useTranslation('subscriptions');
  const isPaid = invoice.status === 'PAID';
  const [viewerOpen, setViewerOpen] = useState(false);

  // Backend's /invoices/:id route resolves by `invoiceNumber`
  // (the INV-YYYYMM-XXXX-XXXXX string), not the UUID. Passing the raw
  // UUID would 404.
  const handleDownload = () => {
    void downloadInvoice(invoice.invoiceNumber);
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg">
            <FileText className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">
              {invoice.invoiceNumber}
            </h3>
            <p className="text-sm text-slate-500">
              {format(new Date(invoice.createdAt), 'dd MMM yyyy')}
            </p>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${
            isPaid
              ? 'bg-green-50 text-green-700'
              : 'bg-yellow-50 text-yellow-700'
          }`}
        >
          {isPaid ? (
            <>
              <CheckCircle2 className="w-3 h-3" />
              {t('subscriptions.invoiceCard.paid')}
            </>
          ) : (
            <>
              <Clock className="w-3 h-3" />
              {t('subscriptions.invoiceCard.open')}
            </>
          )}
        </span>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">{t('subscriptions.invoiceCard.period')}</span>
          <span className="text-slate-900">
            {format(new Date(invoice.periodStart), 'dd MMM')} -{' '}
            {format(new Date(invoice.periodEnd), 'dd MMM yyyy')}
          </span>
        </div>

        {invoice.paidAt && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">{t('subscriptions.invoiceCard.paidOn')}</span>
            <span className="text-slate-900">
              {format(new Date(invoice.paidAt), 'dd MMM yyyy')}
            </span>
          </div>
        )}

        <div className="flex justify-between text-sm pt-2 border-t border-slate-100">
          <span className="font-medium text-slate-900">{t('subscriptions.invoiceCard.total')}</span>
          <span className="font-bold text-slate-900">
            {invoice.currency} {Number(invoice.total).toFixed(2)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setViewerOpen(true)}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-medium"
        >
          <Eye className="w-4 h-4" />
          {t('subscriptions.invoiceCard.view')}
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors text-sm font-medium"
        >
          <Download className="w-4 h-4" />
          {t('subscriptions.invoiceCard.download')}
        </button>
      </div>

      {viewerOpen && (
        <InvoiceViewerModal
          invoiceNumber={invoice.invoiceNumber}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
}
