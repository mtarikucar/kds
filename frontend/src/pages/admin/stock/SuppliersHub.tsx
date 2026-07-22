import { useTranslation } from 'react-i18next';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../../components/ui/Card';
import { ErrorState } from '../../../components/ui/ErrorState';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import { useSupplierScorecard, useApAging } from '../../../features/stock-management/purchasingApi';
import SuppliersTab from '../../../features/stock-management/components/SuppliersTab';
import VendorBillsTab from '../../../features/stock-management/components/VendorBillsTab';

type Fmt = (n: number) => string;

// Tedarikçiler hub: CRUD + price catalog (Phase 2) + scorecard + vendor
// bills + AP aging as stacked sections. Scorecard/AP JSX + hooks
// (useSupplierScorecard, useApAging) are lifted from PurchasingPage.
export default function SuppliersHub() {
  const { t } = useTranslation('stock');
  const fmt = useFormatCurrency();
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-heading font-semibold text-slate-900 mb-3">{t('nav.suppliers')}</h2>
        <SuppliersTab />
      </section>
      {/* Phase 2 slots <SupplierCatalog /> here */}
      <section>
        <h2 className="text-lg font-heading font-semibold text-slate-900 mb-3">{t('sections.scorecard')}</h2>
        <ScorecardSection fmt={fmt} />
      </section>
      <section>
        <h2 className="text-lg font-heading font-semibold text-slate-900 mb-3">{t('sections.vendorBills')}</h2>
        <VendorBillsTab />
      </section>
      <section>
        <h2 className="text-lg font-heading font-semibold text-slate-900 mb-3">{t('sections.apAging')}</h2>
        <ApAgingSection fmt={fmt} />
      </section>
    </div>
  );
}

// Lifted from PurchasingPage.tsx's local `SuppliersTab` (renamed here to
// avoid clashing with the imported CRUD `SuppliersTab` above).
function ScorecardSection({ fmt }: { fmt: Fmt }) {
  const { data, isLoading, isError, error, refetch } = useSupplierScorecard();
  if (isLoading) return <Loading />;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  return (
    <Card>
      <CardHeader><CardTitle>Tedarikçi performansı</CardTitle></CardHeader>
      <CardContent>
        <Table
          head={['Tedarikçi', 'PO', 'Zamanında %', 'Karşılama %', 'Harcama']}
          rows={(data?.suppliers ?? []).map((s: any) => [
            s.supplierName,
            String(s.poCount),
            s.onTimePct != null ? `%${s.onTimePct}` : '—',
            s.fillRatePct != null ? `%${s.fillRatePct}` : '—',
            fmt(s.totalSpend),
          ])}
        />
      </CardContent>
    </Card>
  );
}

// Lifted from PurchasingPage.tsx's `ApAgingTab`.
function ApAgingSection({ fmt }: { fmt: Fmt }) {
  const { data, isLoading, isError, error, refetch } = useApAging();
  if (isLoading) return <Loading />;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  const b = data?.buckets ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="0-30 gün" value={fmt(b.current ?? 0)} />
        <Stat label="31-60 gün" value={fmt(b.d31_60 ?? 0)} tone="amber" />
        <Stat label="61-90 gün" value={fmt(b.d61_90 ?? 0)} tone="amber" />
        <Stat label="90+ gün" value={fmt(b.d90plus ?? 0)} tone="rose" />
      </div>
      <Card>
        <CardHeader><CardTitle>Tedarikçi bazında ödenmemiş ({fmt(data?.total ?? 0)})</CardTitle></CardHeader>
        <CardContent>
          <Table
            head={['Tedarikçi', 'Fatura sayısı', 'Toplam']}
            rows={(data?.bySupplier ?? []).map((s: any) => [s.supplierName ?? s.supplierId, String(s.count), fmt(s.total)])}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ── shared bits (lifted from PurchasingPage.tsx) ──
function Loading() {
  return <div className="py-12 text-center text-slate-400">Yükleniyor…</div>;
}
function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500">{head.map((h) => <th key={h} className="py-2 pr-4">{h}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={head.length} className="py-6 text-center text-slate-400">Kayıt yok.</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((c, j) => <td key={j} className="py-2 pr-4 tabular-nums">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Stat({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'amber' | 'rose' }) {
  const colors: Record<string, string> = { slate: 'text-slate-900', amber: 'text-amber-600', rose: 'text-rose-600' };
  return (
    <Card><CardContent className="pt-6">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${colors[tone]}`}>{value}</p>
    </CardContent></Card>
  );
}
