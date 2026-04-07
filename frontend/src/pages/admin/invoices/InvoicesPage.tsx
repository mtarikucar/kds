import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Receipt, Search, RefreshCw, XCircle } from 'lucide-react';
import { useGetSalesInvoices, useSyncInvoice, useCancelInvoice } from '../../../features/accounting/accountingApi';

const PAGE_SIZE = 20;

const statusColors: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  ISSUED: 'bg-blue-100 text-blue-700',
  SENT: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

const syncColors: Record<string, string> = {
  SYNCED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

const InvoicesPage = () => {
  const { t } = useTranslation('settings');
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const params: Record<string, any> = {
    page,
    limit: PAGE_SIZE,
  };
  if (statusFilter) params.status = statusFilter;
  if (search) params.search = search;

  const { data, isLoading } = useGetSalesInvoices(params);
  const { mutateAsync: syncInvoice } = useSyncInvoice();
  const { mutateAsync: cancelInvoice } = useCancelInvoice();

  const invoices = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSync = async (id: string) => {
    try {
      await syncInvoice(id);
      toast.success(t('accounting.syncAction'));
    } catch {
      toast.error(t('accounting.syncLabel.FAILED'));
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelInvoice(id);
      toast.success(t('accounting.cancelAction'));
    } catch {
      toast.error(t('settingsFailed'));
    }
  };

  const formatCurrency = (amount: number, currency: string) =>
    amount.toLocaleString('tr-TR', { style: 'currency', currency: currency || 'TRY' });

  return (
    <div className="h-full p-4 md:p-6 overflow-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Receipt className="w-6 h-6 text-slate-700" />
          <h1 className="text-xl font-heading font-bold text-slate-900">
            {t('accounting.invoicesTitle')}
          </h1>
        </div>
        <p className="text-sm text-slate-500">{t('accounting.invoicesDesc')}</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t('accounting.searchInvoices')}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500"
        >
          <option value="">{t('accounting.allStatuses')}</option>
          <option value="DRAFT">{t('accounting.invoiceStatus.DRAFT')}</option>
          <option value="ISSUED">{t('accounting.invoiceStatus.ISSUED')}</option>
          <option value="SENT">{t('accounting.invoiceStatus.SENT')}</option>
          <option value="CANCELLED">{t('accounting.invoiceStatus.CANCELLED')}</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('accounting.invoiceNo')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('accounting.customer')}</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">{t('accounting.date')}</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">{t('accounting.amount')}</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">{t('accounting.tax')}</th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">Status</th>
                <th className="text-center px-4 py-3 font-medium text-slate-600">{t('accounting.syncStatus')}</th>
                <th className="text-center px-4 py-3 font-medium text-slate-600"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500">
                    {t('accounting.loading')}
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500">
                    {t('accounting.noInvoices')}
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-900">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 text-slate-600">{inv.customerName || '-'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {new Date(inv.issueDate).toLocaleDateString('tr-TR')}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-900 font-medium">
                      {formatCurrency(inv.totalAmount, inv.currency)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {formatCurrency(inv.taxAmount, inv.currency)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[inv.status] || 'bg-slate-100 text-slate-700'}`}>
                        {t(`accounting.invoiceStatus.${inv.status}` as any) || inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {inv.syncedAt ? (
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${syncColors.SYNCED}`}>
                          {t('accounting.syncLabel.SYNCED')}
                        </span>
                      ) : inv.syncError ? (
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${syncColors.FAILED}`} title={inv.syncError}>
                          {t('accounting.syncLabel.FAILED')}
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600">
                          {t('accounting.syncLabel.notSynced')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {inv.status !== 'CANCELLED' && !inv.syncedAt && (
                          <button
                            onClick={() => handleSync(inv.id)}
                            title={t('accounting.syncAction')}
                            className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        )}
                        {inv.status !== 'CANCELLED' && (
                          <button
                            onClick={() => handleCancel(inv.id)}
                            title={t('accounting.cancelAction')}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('accounting.prev')}
            </button>
            <span className="text-sm text-slate-500">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('accounting.next')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default InvoicesPage;
