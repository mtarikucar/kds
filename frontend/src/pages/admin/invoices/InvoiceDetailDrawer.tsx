import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Undo2 } from 'lucide-react';
import { useInvoice } from '../../../features/accounting/accountingApi';
import { useFormatCurrencyExtended } from '../../../hooks/useFormatCurrency';
import { useFormatDate } from '../../../hooks/useFormatDate';

interface Props {
  invoiceId: string;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 text-right break-words">{value}</span>
    </div>
  );
}

/**
 * D3 — right-hand invoice detail drawer. Fetches GET /sales-invoices/:id
 * (items + parties + KDV breakdown + sync state) and renders the full
 * document; REFUND documents carry an İade badge linking the original.
 */
export default function InvoiceDetailDrawer({ invoiceId, onClose }: Props) {
  const { t } = useTranslation('settings');
  const { data: invoice, isLoading, isError } = useInvoice(invoiceId);
  // Locale-aware money/date rendering (the invoice carries its own currency).
  const { formatWithCurrency } = useFormatCurrencyExtended();
  const { formatDateIntl } = useFormatDate();
  const formatCurrency = (amount: number | string | null | undefined, curr = 'TRY') =>
    formatWithCurrency(Number(amount ?? 0), curr || 'TRY');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const currency = invoice?.currency || 'TRY';

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />

      {/* Panel */}
      <div className="absolute inset-y-0 right-0 w-full max-w-xl bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-base font-heading font-semibold text-slate-900 truncate">
              {invoice
                ? `${t('accounting.drawer.title')} — ${invoice.invoiceNumber}`
                : t('accounting.drawer.title')}
            </h2>
            {invoice?.type === 'REFUND' && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700 whitespace-nowrap"
                title={invoice.originalInvoiceId ?? undefined}
              >
                <Undo2 className="w-3 h-3" />
                {t('accounting.drawer.refundBadge', {
                  id: invoice.originalInvoiceId ?? '-',
                })}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t('accounting.drawer.close')}
            className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg p-1.5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {isLoading ? (
            <div className="py-16 text-center text-sm text-slate-500">
              {t('accounting.loading')}
            </div>
          ) : isError || !invoice ? (
            <div className="py-16 text-center text-sm text-red-600">
              {t('accounting.drawer.loadError')}
            </div>
          ) : (
            <>
              {/* Header summary */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                <Field
                  label={t('accounting.date')}
                  value={formatDateIntl(invoice.issueDate, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                />
                <Field
                  label={t('accounting.drawer.status')}
                  value={t(`accounting.invoiceStatus.${invoice.status}` as any) || invoice.status}
                />
                <Field
                  label={t('accounting.drawer.paymentMethod')}
                  value={invoice.paymentMethod ?? undefined}
                />
              </div>

              {/* Line items */}
              <Section title={t('accounting.drawer.items')}>
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-slate-600">
                        <th className="text-left px-3 py-2 font-medium">{t('accounting.drawer.description')}</th>
                        <th className="text-right px-3 py-2 font-medium">{t('accounting.drawer.quantity')}</th>
                        <th className="text-right px-3 py-2 font-medium">{t('accounting.drawer.unitPrice')}</th>
                        <th className="text-right px-3 py-2 font-medium">{t('accounting.drawer.taxRate')}</th>
                        <th className="text-right px-3 py-2 font-medium">{t('accounting.tax')}</th>
                        <th className="text-right px-3 py-2 font-medium">{t('accounting.drawer.lineTotal')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.items.map((item) => (
                        <tr key={item.id} className="border-b border-slate-50 last:border-0">
                          <td className="px-3 py-2 text-slate-900">{item.description}</td>
                          <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{item.quantity}</td>
                          <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
                            {formatCurrency(item.unitPrice, currency)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600 tabular-nums">%{Number(item.taxRate)}</td>
                          <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
                            {formatCurrency(item.taxAmount, currency)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-900 font-medium tabular-nums">
                            {formatCurrency(item.total, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Totals */}
                <div className="mt-3 ml-auto max-w-xs space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('accounting.drawer.subtotal')}</span>
                    <span className="tabular-nums">{formatCurrency(invoice.subtotal, currency)}</span>
                  </div>
                  {Number(invoice.discount) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">{t('accounting.drawer.discount')}</span>
                      <span className="tabular-nums">-{formatCurrency(invoice.discount, currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t('accounting.tax')}</span>
                    <span className="tabular-nums">{formatCurrency(invoice.taxAmount, currency)}</span>
                  </div>
                  {invoice.withholdingTaxAmount != null && Number(invoice.withholdingTaxAmount) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">
                        {t('accounting.drawer.withholding')}
                        {invoice.withholdingCode ? ` (${invoice.withholdingCode})` : ''}
                      </span>
                      <span className="tabular-nums">
                        -{formatCurrency(invoice.withholdingTaxAmount, currency)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
                    <span>{t('accounting.drawer.total')}</span>
                    <span className="tabular-nums">{formatCurrency(invoice.totalAmount, currency)}</span>
                  </div>
                </div>
              </Section>

              {/* KDV breakdown */}
              {invoice.taxBreakdown && Object.keys(invoice.taxBreakdown).length > 0 && (
                <Section title={t('accounting.drawer.taxBreakdown')}>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-50">
                    {Object.entries(invoice.taxBreakdown).map(([rate, v]) => (
                      <div key={rate} className="flex justify-between px-3 py-2 text-sm">
                        <span className="text-slate-600">
                          {t('accounting.drawer.taxRateRow', { rate: Number(rate) })}
                        </span>
                        <span className="text-slate-600 tabular-nums">
                          {t('accounting.drawer.taxableAmount')}: {formatCurrency(v.taxableAmount, currency)}
                        </span>
                        <span className="text-slate-900 font-medium tabular-nums">
                          {formatCurrency(v.taxAmount, currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Parties */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <Section title={t('accounting.drawer.customerBlock')}>
                  <div className="border border-slate-200 rounded-lg px-3 py-2">
                    <Field label={t('accounting.customer')} value={invoice.customerName} />
                    <Field label={t('accounting.drawer.taxId')} value={invoice.customerTaxId} />
                    <Field label={t('accounting.companyTaxOffice')} value={invoice.customerTaxOffice} />
                    <Field label={t('accounting.companyPhone')} value={invoice.customerPhone} />
                    <Field label={t('accounting.companyEmail')} value={invoice.customerEmail} />
                    {!invoice.customerName &&
                      !invoice.customerTaxId &&
                      !invoice.customerTaxOffice &&
                      !invoice.customerPhone &&
                      !invoice.customerEmail && (
                        <p className="py-1 text-sm text-slate-400">{t('accounting.drawer.empty')}</p>
                      )}
                  </div>
                </Section>
                <Section title={t('accounting.drawer.sellerBlock')}>
                  <div className="border border-slate-200 rounded-lg px-3 py-2">
                    <Field label={t('accounting.companyName')} value={invoice.sellerName} />
                    <Field label={t('accounting.drawer.taxId')} value={invoice.sellerTaxId} />
                    <Field label={t('accounting.companyTaxOffice')} value={invoice.sellerTaxOffice} />
                    <Field label={t('accounting.companyAddress')} value={invoice.sellerAddress} />
                    <Field label={t('accounting.companyPhone')} value={invoice.sellerPhone} />
                    <Field label={t('accounting.companyEmail')} value={invoice.sellerEmail} />
                    {!invoice.sellerName && !invoice.sellerTaxId && (
                      <p className="py-1 text-sm text-slate-400">{t('accounting.drawer.empty')}</p>
                    )}
                  </div>
                </Section>
              </div>

              {/* Sync state */}
              <Section title={t('accounting.syncStatus')}>
                <div className="border border-slate-200 rounded-lg px-3 py-2">
                  <div className="flex justify-between gap-3 py-1 text-sm">
                    <span className="text-slate-500">{t('accounting.drawer.status')}</span>
                    {invoice.syncedAt ? (
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
                        {t('accounting.syncLabel.SYNCED')}
                      </span>
                    ) : invoice.syncError ? (
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
                        {t('accounting.syncLabel.FAILED')}
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-slate-100 text-slate-600">
                        {t('accounting.syncLabel.notSynced')}
                      </span>
                    )}
                  </div>
                  <Field
                    label={t('accounting.drawer.syncedAt')}
                    value={
                      invoice.syncedAt
                        ? formatDateIntl(invoice.syncedAt, {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })
                        : undefined
                    }
                  />
                  <Field label={t('accounting.provider')} value={invoice.externalProvider} />
                  <Field label={t('accounting.drawer.externalId')} value={invoice.externalId} />
                  {invoice.syncError && (
                    <p className="py-1 text-sm text-red-600 break-words">{invoice.syncError}</p>
                  )}
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
