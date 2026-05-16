import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Download, Loader2 } from 'lucide-react';
import api from '../../lib/api';

interface InvoiceViewerModalProps {
  invoiceNumber: string | null;
  onClose: () => void;
}

/**
 * Inline PDF preview backed by /invoices/:id/download. We fetch the
 * blob through the authed axios client (cookies / JWT) and embed it
 * via object URL — `window.open` to that URL would dodge auth headers
 * and 401.
 */
export default function InvoiceViewerModal({
  invoiceNumber,
  onClose,
}: InvoiceViewerModalProps) {
  const { t } = useTranslation('subscriptions');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceNumber) {
      setBlobUrl(null);
      return;
    }
    setLoading(true);
    setError(null);
    let cancelled = false;
    let createdUrl: string | null = null;
    api
      .get(`/invoices/${invoiceNumber}/download`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        const blob = new Blob([res.data], { type: 'application/pdf' });
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(
          err?.response?.data?.message ??
            err?.message ??
            t('subscriptions.invoiceViewer.loadFailed'),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [invoiceNumber, t]);

  if (!invoiceNumber) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div>
            <h2 className="font-semibold text-slate-900">{invoiceNumber}</h2>
            <p className="text-xs text-slate-500">{t('subscriptions.invoiceViewer.title')}</p>
          </div>
          <div className="flex items-center gap-2">
            {blobUrl && (
              <a
                href={blobUrl}
                download={`invoice-${invoiceNumber}.pdf`}
                className="flex items-center gap-1 text-sm px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded"
              >
                <Download className="w-4 h-4" />
                {t('subscriptions.invoiceCard.download')}
              </a>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-lg"
              aria-label={t('subscriptions.invoiceViewer.close')}
            >
              <X className="w-5 h-5 text-slate-600" />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-slate-100">
          {loading && (
            <div className="h-full flex items-center justify-center text-slate-600">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              {t('subscriptions.invoiceViewer.loading')}
            </div>
          )}
          {error && (
            <div className="h-full flex items-center justify-center text-red-600 text-sm">
              {error}
            </div>
          )}
          {blobUrl && !error && (
            <iframe
              src={blobUrl}
              title={`Invoice ${invoiceNumber}`}
              className="w-full h-full"
            />
          )}
        </div>
      </div>
    </div>
  );
}
