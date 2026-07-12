import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Scale, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../../components/ui/Card';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import { useAuthStore } from '../../../store/authStore';
import {
  useVendorBills,
  useCreateVendorBill,
  useVendorBillMatch,
  useApproveVendorBill,
  useMarkVendorBillPaid,
  type VendorBill,
} from '../purchasingApi';
import { useSuppliers, usePurchaseOrders } from '../stockManagementApi';

/**
 * Tedarikçi Faturaları (AP) — vendor bills recorded against suppliers, with an
 * optional PurchaseOrder link that drives the backend's 3-way match
 * (ordered / received / invoiced). Approve → mark-paid is the payment rail;
 * both backend endpoints require ADMIN or MANAGER, so the action buttons are
 * hidden for any other role.
 */

const BILL_STATUSES = [
  'RECEIVED',
  'MATCHED',
  'DISCREPANCY',
  'APPROVED',
  'PAID',
] as const;

const APPROVABLE = ['RECEIVED', 'MATCHED', 'DISCREPANCY'];

export default function VendorBillsTab() {
  const { t } = useTranslation('stock');
  const fmt = useFormatCurrency();
  const role = useAuthStore((s) => s.user?.role);
  const canAct = role === 'ADMIN' || role === 'MANAGER';

  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [matchBillId, setMatchBillId] = useState<string | null>(null);

  const {
    data: bills,
    isLoading,
    isError,
    refetch,
  } = useVendorBills(statusFilter ? { status: statusFilter } : undefined);
  const { data: suppliers } = useSuppliers();
  const { data: orders } = usePurchaseOrders();
  const approve = useApproveVendorBill();
  const markPaid = useMarkVendorBillPaid();

  const supplierName = (id: string) =>
    suppliers?.find((s) => s.id === id)?.name ?? '—';
  const poNumber = (id: string | null) =>
    id ? (orders?.find((o) => o.id === id)?.orderNumber ?? '…') : '—';

  const busy = approve.isPending || markPaid.isPending;
  const onActionError = (e: unknown) =>
    toast.error(
      (e as { response?: { data?: { message?: string } } })?.response?.data
        ?.message ?? t('vendorBills.actionError')
    );

  const matchBill = matchBillId
    ? (bills ?? []).find((b) => b.id === matchBillId)
    : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor="vb-status-filter" className="text-sm text-slate-500">
            {t('vendorBills.status')}
          </label>
          <select
            id="vb-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border-slate-300 text-sm"
          >
            <option value="">{t('vendorBills.filterAll')}</option>
            {BILL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`vendorBills.statusLabels.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" /> {t('vendorBills.new')}
        </button>
      </div>

      {showForm && (
        <VendorBillForm
          onClose={() => setShowForm(false)}
          onCreated={() => setShowForm(false)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('vendorBills.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-slate-400">
              {t('common.loading')}
            </div>
          ) : isError ? (
            <div className="py-8 text-center">
              <p className="text-sm text-rose-600">
                {t('vendorBills.loadError')}
              </p>
              <button
                onClick={() => refetch()}
                className="mt-2 text-sm text-indigo-600 hover:underline"
              >
                {t('vendorBills.retry')}
              </button>
            </div>
          ) : !bills || bills.length === 0 ? (
            statusFilter ? (
              <div className="py-8 text-center text-slate-400">
                {t('vendorBills.noneForFilter')}
              </div>
            ) : (
              <div className="py-8 text-center">
                <p className="text-slate-400">{t('vendorBills.empty')}</p>
                <button
                  onClick={() => setShowForm(true)}
                  className="mt-3 inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  <Plus className="h-4 w-4" /> {t('vendorBills.createCta')}
                </button>
              </div>
            )
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2 pr-4">{t('vendorBills.invoiceNumber')}</th>
                    <th className="py-2 pr-4">{t('vendorBills.supplier')}</th>
                    <th className="py-2 pr-4">{t('vendorBills.date')}</th>
                    <th className="py-2 pr-4">{t('vendorBills.total')}</th>
                    <th className="py-2 pr-4">{t('vendorBills.status')}</th>
                    <th className="py-2 pr-4">{t('vendorBills.linkedPo')}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b) => (
                    <tr key={b.id} className="border-t border-slate-100">
                      <td className="py-2 pr-4 font-medium">{b.invoiceNumber}</td>
                      <td className="py-2 pr-4">{supplierName(b.supplierId)}</td>
                      <td className="py-2 pr-4 tabular-nums">
                        {new Date(b.invoiceDate).toLocaleDateString()}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {fmt(Number(b.total))}
                      </td>
                      <td className="py-2 pr-4">
                        <BillStatusPill status={b.status} />
                      </td>
                      <td className="py-2 pr-4">{poNumber(b.purchaseOrderId)}</td>
                      <td className="py-2 text-right space-x-3 whitespace-nowrap">
                        {b.purchaseOrderId && (
                          <button
                            onClick={() =>
                              setMatchBillId((cur) =>
                                cur === b.id ? null : b.id
                              )
                            }
                            className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                          >
                            <Scale className="h-3.5 w-3.5" />
                            {t('vendorBills.match.title')}
                          </button>
                        )}
                        {canAct && APPROVABLE.includes(b.status) && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              approve.mutate(b.id, {
                                onSuccess: () =>
                                  toast.success(t('vendorBills.approved')),
                                onError: onActionError,
                              })
                            }
                            className="text-emerald-600 hover:underline disabled:opacity-50"
                          >
                            {t('vendorBills.approve')}
                          </button>
                        )}
                        {canAct && b.status === 'APPROVED' && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              markPaid.mutate(b.id, {
                                onSuccess: () =>
                                  toast.success(t('vendorBills.paidMarked')),
                                onError: onActionError,
                              })
                            }
                            className="text-emerald-600 hover:underline disabled:opacity-50"
                          >
                            {t('vendorBills.markPaid')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {matchBill && (
        <VendorBillMatchPanel
          bill={matchBill}
          onClose={() => setMatchBillId(null)}
        />
      )}
    </div>
  );
}

function BillStatusPill({ status }: { status: string }) {
  const { t } = useTranslation('stock');
  const tone: Record<string, string> = {
    RECEIVED: 'bg-slate-100 text-slate-600',
    MATCHED: 'bg-emerald-100 text-emerald-700',
    DISCREPANCY: 'bg-rose-100 text-rose-700',
    APPROVED: 'bg-indigo-100 text-indigo-700',
    PAID: 'bg-emerald-100 text-emerald-700',
  };
  const known = BILL_STATUSES.includes(status as (typeof BILL_STATUSES)[number]);
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${tone[status] ?? 'bg-slate-100 text-slate-600'}`}
    >
      {known ? t(`vendorBills.statusLabels.${status}`) : status}
    </span>
  );
}

// ── Create form ──────────────────────────────────────────────────────────────

function VendorBillForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation('stock');
  const fmt = useFormatCurrency();
  const { data: suppliers } = useSuppliers();
  const { data: orders } = usePurchaseOrders();
  const create = useCreateVendorBill();

  const [supplierId, setSupplierId] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [subtotal, setSubtotal] = useState('');
  const [taxAmount, setTaxAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Only POs of the chosen supplier are meaningful 3-way-match targets.
  const supplierOrders = useMemo(
    () => (orders ?? []).filter((o) => o.supplierId === supplierId),
    [orders, supplierId]
  );

  const subtotalNum = Number(subtotal);
  const taxNum = taxAmount === '' ? 0 : Number(taxAmount);
  const totalPreview =
    subtotal !== '' && Number.isFinite(subtotalNum) && Number.isFinite(taxNum)
      ? subtotalNum + taxNum
      : null;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!supplierId) e.supplierId = t('vendorBills.form.supplierRequired');
    if (!invoiceNumber.trim())
      e.invoiceNumber = t('vendorBills.form.invoiceNumberRequired');
    if (!invoiceDate) e.invoiceDate = t('vendorBills.form.invoiceDateRequired');
    if (subtotal === '' || !Number.isFinite(subtotalNum) || subtotalNum < 0)
      e.subtotal = t('vendorBills.form.amountInvalid');
    if (taxAmount !== '' && (!Number.isFinite(taxNum) || taxNum < 0))
      e.taxAmount = t('vendorBills.form.amountInvalid');
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    create.mutate(
      {
        supplierId,
        purchaseOrderId: purchaseOrderId || undefined,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate,
        subtotal: Math.round(subtotalNum * 100) / 100,
        taxAmount: Math.round(taxNum * 100) / 100,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t('vendorBills.form.created'));
          onCreated();
        },
        onError: (e) =>
          toast.error(
            (e as { response?: { data?: { message?: string } } })?.response
              ?.data?.message ?? t('vendorBills.form.createError')
          ),
      }
    );
  };

  const field = (err?: string) =>
    `w-full rounded-md text-sm ${err ? 'border-rose-400' : 'border-slate-300'}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {t('vendorBills.form.title')}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label htmlFor="vb-supplier" className="mb-1 block text-xs font-medium text-slate-600">
                {t('vendorBills.supplier')} *
              </label>
              <select
                id="vb-supplier"
                value={supplierId}
                onChange={(e) => {
                  setSupplierId(e.target.value);
                  setPurchaseOrderId('');
                }}
                className={field(errors.supplierId)}
              >
                <option value="">{t('vendorBills.form.selectSupplier')}</option>
                {(suppliers ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {errors.supplierId && <FieldError text={errors.supplierId} />}
            </div>

            <div>
              <label htmlFor="vb-po" className="mb-1 block text-xs font-medium text-slate-600">
                {t('vendorBills.form.selectPo')}
              </label>
              <select
                id="vb-po"
                value={purchaseOrderId}
                onChange={(e) => setPurchaseOrderId(e.target.value)}
                disabled={!supplierId}
                className="w-full rounded-md border-slate-300 text-sm disabled:opacity-50"
              >
                <option value="">{t('vendorBills.form.noPo')}</option>
                {supplierOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNumber}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="vb-number" className="mb-1 block text-xs font-medium text-slate-600">
                {t('vendorBills.invoiceNumber')} *
              </label>
              <input
                id="vb-number"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                maxLength={64}
                className={field(errors.invoiceNumber)}
              />
              {errors.invoiceNumber && (
                <FieldError text={errors.invoiceNumber} />
              )}
            </div>

            <div>
              <label htmlFor="vb-date" className="mb-1 block text-xs font-medium text-slate-600">
                {t('vendorBills.form.invoiceDate')} *
              </label>
              <input
                id="vb-date"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className={field(errors.invoiceDate)}
              />
              {errors.invoiceDate && <FieldError text={errors.invoiceDate} />}
            </div>

            <div>
              <label htmlFor="vb-subtotal" className="mb-1 block text-xs font-medium text-slate-600">
                {t('vendorBills.form.subtotal')} *
              </label>
              <input
                id="vb-subtotal"
                type="number"
                min="0"
                step="0.01"
                value={subtotal}
                onChange={(e) => setSubtotal(e.target.value)}
                className={field(errors.subtotal)}
              />
              {errors.subtotal && <FieldError text={errors.subtotal} />}
            </div>

            <div>
              <label htmlFor="vb-tax" className="mb-1 block text-xs font-medium text-slate-600">
                {t('vendorBills.form.taxAmount')}
              </label>
              <input
                id="vb-tax"
                type="number"
                min="0"
                step="0.01"
                value={taxAmount}
                onChange={(e) => setTaxAmount(e.target.value)}
                className={field(errors.taxAmount)}
              />
              {errors.taxAmount && <FieldError text={errors.taxAmount} />}
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="vb-notes" className="mb-1 block text-xs font-medium text-slate-600">
                {t('vendorBills.form.notes')}
              </label>
              <input
                id="vb-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                className="w-full rounded-md border-slate-300 text-sm"
              />
            </div>

            <div className="flex items-end justify-between gap-2">
              <p className="text-sm text-slate-500">
                {t('vendorBills.total')}:{' '}
                <span className="font-semibold tabular-nums text-slate-900">
                  {totalPreview != null ? fmt(totalPreview) : '—'}
                </span>
              </p>
              <button
                type="submit"
                disabled={create.isPending}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {create.isPending ? '…' : t('vendorBills.form.submit')}
              </button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function FieldError({ text }: { text: string }) {
  return <p className="mt-1 text-xs text-rose-600">{text}</p>;
}

// ── 3-way match panel ────────────────────────────────────────────────────────

function VendorBillMatchPanel({
  bill,
  onClose,
}: {
  bill: VendorBill;
  onClose: () => void;
}) {
  const { t } = useTranslation('stock');
  const fmt = useFormatCurrency();
  const { data, isLoading, isError } = useVendorBillMatch(bill.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2">
            <Scale className="h-4 w-4" />
            {t('vendorBills.match.title')} — {bill.invoiceNumber}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('vendorBills.match.close')}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="py-8 text-center text-slate-400">
            {t('common.loading')}
          </div>
        ) : isError ? (
          <p className="py-6 text-center text-sm text-rose-600">
            {t('vendorBills.match.loadError')}
          </p>
        ) : !data ? null : !data.linked ? (
          <p className="py-6 text-center text-sm text-slate-500">
            {t('vendorBills.match.notLinked')} —{' '}
            <span className="tabular-nums">{fmt(data.invoiceTotal)}</span>
          </p>
        ) : (
          <div className="space-y-3">
            <p
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                data.matched
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-700'
              }`}
            >
              {data.matched
                ? t('vendorBills.match.matched')
                : t('vendorBills.match.discrepancy')}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2 pr-4">{t('vendorBills.match.source')}</th>
                    <th className="py-2 pr-4">{t('vendorBills.match.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-100">
                    <td className="py-2 pr-4">{t('vendorBills.match.ordered')}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {fmt(data.orderedTotal ?? 0)}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-100">
                    <td className="py-2 pr-4">{t('vendorBills.match.received')}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {fmt(data.receivedTotal ?? 0)}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-100">
                    <td className="py-2 pr-4">{t('vendorBills.match.invoiced')}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {fmt(data.invoiceTotal)}
                    </td>
                  </tr>
                  <tr
                    data-testid="match-variance-row"
                    className={`border-t border-slate-100 font-medium ${
                      data.matched ? '' : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    <td className="py-2 pr-4">{t('vendorBills.match.variance')}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {fmt(data.variance ?? 0)}
                    </td>
                  </tr>
                  <tr className="border-t border-slate-100 text-slate-500">
                    <td className="py-2 pr-4">{t('vendorBills.match.tolerance')}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      ± {fmt(data.tolerance ?? 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
