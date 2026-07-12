import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Receipt, Search, RefreshCw, XCircle, Undo2, FilePlus2, Settings2 } from 'lucide-react';
import {
  useGetSalesInvoices,
  useSyncInvoice,
  useCancelInvoice,
  useGetAccountingSettings,
} from '../../../features/accounting/accountingApi';
import { useIssueCreditNote } from '../../../features/accounting/eBelgeApi';
import type { SalesInvoice } from '../../../features/accounting/types';
import CreateInvoiceFromOrderModal from './CreateInvoiceFromOrderModal';
import InvoiceDetailDrawer from './InvoiceDetailDrawer';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;
const HIGHLIGHT_MS = 6000;

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

// Reusable invoice-list body (no page chrome) so both the standalone
// /admin/invoices route AND the Muhasebe page's "Faturalar" tab render it.
export const InvoicesPanel = () => {
  const { t } = useTranslation('settings');
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [syncFilter, setSyncFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // Debounced search: the input updates immediately, the applied query
  // param only after SEARCH_DEBOUNCE_MS of quiet — no per-keystroke fetch.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  const params: Record<string, any> = {
    page,
    limit: PAGE_SIZE,
  };
  if (statusFilter) params.status = statusFilter;
  if (syncFilter) params.syncStatus = syncFilter;
  // Date inputs are day-granular; widen to the local day's bounds so the
  // end day is INCLUSIVE (a bare "2026-07-12" would be midnight and drop
  // every invoice issued later that day).
  if (startDate) params.startDate = new Date(`${startDate}T00:00:00`).toISOString();
  if (endDate) params.endDate = new Date(`${endDate}T23:59:59.999`).toISOString();
  if (search) params.search = search;

  const { data, isLoading, isError, refetch } = useGetSalesInvoices(params);
  const { data: accountingSettings } = useGetAccountingSettings();
  const { mutateAsync: syncInvoice } = useSyncInvoice();
  const { mutateAsync: cancelInvoice } = useCancelInvoice();
  const creditNote = useIssueCreditNote();

  const invoices = data?.data ?? [];
  const totalPages = data?.meta.totalPages ?? 1;
  const hasActiveFilters = Boolean(statusFilter || syncFilter || startDate || endDate || search);
  const providerNotConfigured = accountingSettings?.provider === 'NONE';

  const handleSync = async (id: string) => {
    try {
      const updated = await syncInvoice(id);
      // The endpoint re-reads the invoice after the sync attempt. A NONE
      // provider (or an otherwise skipped push) leaves it untouched — don't
      // celebrate a no-op with a success toast.
      if (updated?.syncedAt) {
        toast.success(t('accounting.syncSuccess'));
      } else if (updated?.syncError) {
        toast.error(t('accounting.syncLabel.FAILED'));
      } else {
        toast.info(t('accounting.syncNoop'));
      }
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

  const handleCreditNote = async (id: string) => {
    if (!window.confirm(t('accounting.creditNoteConfirm'))) return;
    try {
      await creditNote.mutateAsync(id);
      toast.success(t('accounting.creditNoteIssued'));
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? t('accounting.creditNoteError'));
    }
  };

  const handleCreated = (invoice: SalesInvoice) => {
    setIsCreateOpen(false);
    // Newest issueDate sorts first — reset filters/page so the fresh
    // invoice is actually on screen, then highlight it briefly.
    setStatusFilter('');
    setSyncFilter('');
    setStartDate('');
    setEndDate('');
    setSearchInput('');
    setSearch('');
    setPage(1);
    setHighlightId(invoice.id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
  };

  const formatCurrency = (amount: number | string, currency: string) =>
    Number(amount).toLocaleString('tr-TR', { style: 'currency', currency: currency || 'TRY' });

  return (
    <>
      {/* Filters + create action */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-3 flex-1 flex-wrap">
          <div className="relative flex-1 max-w-sm min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
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
          <select
            value={syncFilter}
            onChange={(e) => { setSyncFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500"
          >
            <option value="">{t('accounting.allSyncStatuses')}</option>
            <option value="SYNCED">{t('accounting.syncLabel.SYNCED')}</option>
            <option value="FAILED">{t('accounting.syncLabel.FAILED')}</option>
            <option value="PENDING">{t('accounting.syncLabel.notSynced')}</option>
          </select>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              aria-label={t('accounting.filterStartDate')}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500"
            />
            <span className="text-slate-400 text-sm">—</span>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              aria-label={t('accounting.filterEndDate')}
              className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg whitespace-nowrap"
        >
          <FilePlus2 className="w-4 h-4" />
          {t('accounting.createInvoice')}
        </button>
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
                <th className="text-center px-4 py-3 font-medium text-slate-600">{t('accounting.statusColumn')}</th>
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
              ) : isError ? (
                <tr>
                  <td colSpan={8} className="text-center py-12">
                    <p className="text-red-600 mb-3">{t('accounting.listError')}</p>
                    <button
                      onClick={() => refetch()}
                      className="px-4 py-2 text-sm font-medium text-primary-700 border border-primary-200 hover:bg-primary-50 rounded-lg"
                    >
                      {t('accounting.retry')}
                    </button>
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-500">
                    <p>{t('accounting.noInvoices')}</p>
                    {/* Onboarding CTA: an empty, unfiltered list on a tenant
                        without an integrator points at the real next step. */}
                    {!hasActiveFilters && providerNotConfigured && (
                      <div className="mt-3">
                        <p className="text-sm text-slate-500 mb-2">{t('accounting.noProviderCta')}</p>
                        <Link
                          to="/admin/settings/accounting"
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-700 border border-primary-200 hover:bg-primary-50 rounded-lg"
                        >
                          <Settings2 className="w-4 h-4" />
                          {t('accounting.noProviderCtaLink')}
                        </Link>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => setDetailId(inv.id)}
                    className={`border-b border-slate-50 cursor-pointer transition-colors ${
                      highlightId === inv.id ? 'bg-amber-50' : 'hover:bg-slate-50/50'
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <span className="inline-flex items-center gap-2">
                        {inv.invoiceNumber}
                        {inv.type === 'REFUND' && (
                          <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                            {t('accounting.refundType')}
                          </span>
                        )}
                      </span>
                    </td>
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
                      <div
                        className="flex items-center justify-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {inv.status !== 'CANCELLED' && !inv.syncedAt && (
                          <button
                            onClick={() => handleSync(inv.id)}
                            title={t('accounting.syncAction')}
                            className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        )}
                        {inv.status !== 'CANCELLED' && inv.type !== 'REFUND' && (
                          // İade Faturası — credits the whole invoice (backend
                          // dedupes: one credit note per original).
                          <button
                            onClick={() => handleCreditNote(inv.id)}
                            disabled={creditNote.isPending}
                            title={t('accounting.creditNoteAction')}
                            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
                          >
                            <Undo2 className="w-4 h-4" />
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

      {isCreateOpen && (
        <CreateInvoiceFromOrderModal
          onClose={() => setIsCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}

      {detailId && (
        <InvoiceDetailDrawer invoiceId={detailId} onClose={() => setDetailId(null)} />
      )}
    </>
  );
};

// Standalone page = header chrome + the shared panel.
const InvoicesPage = () => {
  const { t } = useTranslation('settings');
  return (
    <div className="h-full p-4 md:p-6 overflow-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Receipt className="w-6 h-6 text-slate-700" />
          <h1 className="text-xl font-heading font-bold text-slate-900">
            {t('accounting.invoicesTitle')}
          </h1>
        </div>
        <p className="text-sm text-slate-500">{t('accounting.invoicesDesc')}</p>
      </div>
      <InvoicesPanel />
    </div>
  );
};

export default InvoicesPage;
