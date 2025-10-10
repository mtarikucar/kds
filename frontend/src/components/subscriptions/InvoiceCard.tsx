import { FileText, Download, CheckCircle2, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { downloadInvoice } from '../../api/paymentsApi';

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
  const isPaid = invoice.status === 'PAID';

  const handleDownload = () => {
    downloadInvoice(invoice.id);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg">
            <FileText className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">
              {invoice.invoiceNumber}
            </h3>
            <p className="text-sm text-gray-500">
              {format(new Date(invoice.createdAt), 'MMM dd, yyyy')}
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
              Paid
            </>
          ) : (
            <>
              <Clock className="w-3 h-3" />
              Open
            </>
          )}
        </span>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Period</span>
          <span className="text-gray-900">
            {format(new Date(invoice.periodStart), 'MMM dd')} -{' '}
            {format(new Date(invoice.periodEnd), 'MMM dd, yyyy')}
          </span>
        </div>

        {invoice.paidAt && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Paid on</span>
            <span className="text-gray-900">
              {format(new Date(invoice.paidAt), 'MMM dd, yyyy')}
            </span>
          </div>
        )}

        <div className="flex justify-between text-sm pt-2 border-t border-gray-100">
          <span className="font-medium text-gray-900">Total</span>
          <span className="font-bold text-gray-900">
            {invoice.currency} {Number(invoice.total).toFixed(2)}
          </span>
        </div>
      </div>

      <button
        onClick={handleDownload}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors text-sm font-medium"
      >
        <Download className="w-4 h-4" />
        Download Invoice
      </button>
    </div>
  );
}
