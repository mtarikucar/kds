import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Banknote, Printer, CreditCard, TrendingUp } from 'lucide-react';
import { format, addDays, startOfDay } from 'date-fns';
import StatCard from '../../../components/ui/StatCard';
import { useSubscription } from '../../../contexts/SubscriptionContext';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import { useCashierSessions } from '../../../features/cash/cashApi';
import { useListFiscalDevices, useListPendingReceipts } from '../../../features/fiscal/fiscalApi';
import { useAccountingSyncStatus } from '../../../features/accounting/accountingApi';
import { useTerminalReconciliation } from '../../../features/payment-terminal/paymentTerminalApi';
import { useSalesReport } from '../../../features/reports/reportsApi';
import api from '../../../lib/api';

/**
 * Finans → Genel Bakış. "Bugün ne durumdayım?" tek ekranda: kasadaki beklenen
 * nakit, açık vardiyalar (+dünden kalan uyarısı), bugünkü satış (advancedReports
 * varsa), yazarkasa sağlığı (fiscal yoksa DÜRÜST upsell), gönderilemeyen belge
 * sayacı, mutabakat bekleyen çekimler. Tamamı MEVCUT uçlardan — yeni backend yok.
 * Rules-of-hooks: entegrasyon-koşullu sorgular gate'li SARMALAYICI bileşende
 * (KpiStrip deseni, bkz. DashboardPage.TodayKpiStrip) — koşulsuz hook çağrısı.
 */
type NavigateFn = (group: 'cash' | 'documents', tab?: string) => void;

export default function FinanceOverview({ onNavigate }: { onNavigate: NavigateFn }) {
  const { t } = useTranslation('common');
  const fmt = useFormatCurrency();
  const { hasFeature, hasIntegration } = useSubscription();
  const { data: sessions = [], isLoading: sessionsLoading } = useCashierSessions('OPEN');

  // Açık vardiyaların X-report'ları — beklenen nakit toplamı.
  const xReports = useQueries({
    queries: (sessions as { id: string }[]).map((s) => ({
      queryKey: ['cash', 'x-report', s.id],
      queryFn: async () => (await api.get(`/cash-drawer/sessions/${s.id}/x-report`)).data,
    })),
  });
  const expectedCash = xReports.reduce(
    (sum, q) => sum + (q.data?.expectedCash ?? 0), 0);
  const staleSessions = (sessions as { id: string; openedAt: string }[]).filter(
    (s) => new Date(s.openedAt) < startOfDay(new Date()),
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button type="button" onClick={() => onNavigate('cash')} className="text-left">
          <StatCard
            title={t('finance.overview.expectedCash', 'Kasadaki beklenen nakit')}
            value={fmt(expectedCash)}
            icon={Banknote}
            color="bg-emerald-500"
            isLoading={sessionsLoading || xReports.some((q) => q.isLoading)}
          />
        </button>
        <button type="button" onClick={() => onNavigate('cash')} className="text-left">
          <StatCard
            title={t('finance.overview.openSessions', 'Açık vardiya')}
            value={sessions.length}
            icon={CreditCard}
            color="bg-indigo-500"
            isLoading={sessionsLoading}
          />
        </button>
        {hasFeature('advancedReports') && <TodaySalesCard />}
        {hasIntegration('fiscal') ? <FiscalStatusCard /> : <FiscalUpsellCard />}
      </div>

      <DocumentsCounterRow onNavigate={onNavigate} />
      <ReconciliationRow />

      {staleSessions.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>
            {t('finance.overview.staleSessionWarning', {
              defaultValue: 'Dünden kalan {{count}} açık vardiya var — gün sonu mutabakatı yapılmadı.',
              count: staleSessions.length,
            })}
          </span>
          <button
            type="button"
            onClick={() => onNavigate('cash')}
            className="rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700"
          >
            {t('finance.overview.closeAction', 'Kapat')}
          </button>
        </div>
      )}
    </div>
  );
}

/** advancedReports garantili çağrılır (gate dışarıda) — hook koşulsuz. */
function TodaySalesCard() {
  const { t } = useTranslation('common');
  const fmt = useFormatCurrency();
  const now = new Date();
  const range = { startDate: format(now, 'yyyy-MM-dd'), endDate: format(addDays(now, 1), 'yyyy-MM-dd') };
  const { data, isLoading } = useSalesReport(range);
  return (
    <StatCard
      title={t('finance.overview.todaysSales', "Bugünkü satış")}
      value={fmt(data?.totalSales ?? 0)}
      icon={TrendingUp}
      color="bg-blue-500"
      isLoading={isLoading}
    />
  );
}

function FiscalStatusCard() {
  const { t } = useTranslation('common');
  const { data: devices = [], isError } = useListFiscalDevices();
  const list = isError ? [] : devices;
  const online = list.filter((d) => d.status === 'online').length;
  return (
    <StatCard
      title={t('finance.overview.fiscalDevices', 'Yazarkasa')}
      value={list.length === 0
        ? t('finance.overview.fiscalNone', 'Kurulmadı')
        : `${online}/${list.length} ${t('finance.overview.fiscalReady', 'hazır')}`}
      icon={Printer}
      color={online > 0 ? 'bg-emerald-500' : 'bg-slate-400'}
    />
  );
}

/** Dürüst upsell — eski "cihaz yapılandırılmamış" sessizliğinin yerine. */
function FiscalUpsellCard() {
  const { t } = useTranslation('common');
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
      <p className="font-medium">{t('finance.overview.fiscalUpsellTitle', 'Yazarkasa bağlantısı')}</p>
      <p className="mt-1 text-xs">
        {t('finance.overview.fiscalUpsellBody', 'Mali fiş basmak için yazarkasa eklentisi gerekir.')}
      </p>
      <Link to="/admin/store" className="mt-2 inline-block text-xs font-semibold text-indigo-600 hover:underline">
        {t('finance.overview.fiscalUpsellCta', 'Mağazaya git')}
      </Link>
    </div>
  );
}

/** Sayaç iki koşullu kaynaktan gelebilir (accounting sync-failed + fiscal
 *  pending-receipts). Rules-of-hooks: hangi hook'ların çağrılacağı entegrasyon
 *  setine göre DEĞİŞTİĞİ için (fiscal'siz tenant'ta useListPendingReceipts hiç
 *  çağrılmamalı — 403'e bağlı gereksiz istek), varyant bileşenlere ayrılır;
 *  her varyant kendi sabit hook setini koşulsuz çağırır. */
function DocumentsCounterRow({ onNavigate }: { onNavigate: NavigateFn }) {
  const { hasIntegration } = useSubscription();
  const acc = hasIntegration('accounting');
  const fis = hasIntegration('fiscal');
  if (!acc && !fis) return null;
  if (fis) return <DocumentsCounterWithFiscal acc={acc} onNavigate={onNavigate} />;
  return <DocumentsCounterAccountingOnly onNavigate={onNavigate} />;
}

function DocumentsCounterBody({ failedDocs, onNavigate }: { failedDocs: number; onNavigate: NavigateFn }) {
  const { t } = useTranslation('common');
  if (failedDocs === 0) return null;
  return (
    <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <span>
        {t('finance.overview.failedDocs', { defaultValue: 'Gönderilemeyen belge:' })}{' '}
        <strong className="tabular-nums">{failedDocs}</strong>
      </span>
      <button
        type="button"
        onClick={() => onNavigate('documents', 'edoc')}
        className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700"
      >
        {t('finance.overview.fixAction', 'Düzelt')}
      </button>
    </div>
  );
}

/** fiscal entegrasyonu VAR — iki hook da koşulsuz çağrılır. */
function DocumentsCounterWithFiscal({ acc, onNavigate }: { acc: boolean; onNavigate: NavigateFn }) {
  const sync = useAccountingSyncStatus(acc);
  const pending = useListPendingReceipts();
  const failedDocs = (acc ? (sync.data?.failed ?? 0) : 0) + (pending.data?.length ?? 0);
  return <DocumentsCounterBody failedDocs={failedDocs} onNavigate={onNavigate} />;
}

/** fiscal YOK, sadece accounting — useListPendingReceipts hiç çağrılmaz. */
function DocumentsCounterAccountingOnly({ onNavigate }: { onNavigate: NavigateFn }) {
  const sync = useAccountingSyncStatus(true);
  const failedDocs = sync.data?.failed ?? 0;
  return <DocumentsCounterBody failedDocs={failedDocs} onNavigate={onNavigate} />;
}

function ReconciliationRow() {
  const { t } = useTranslation('common');
  const { data = [] } = useTerminalReconciliation();
  if (data.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {t('finance.overview.reconciliation', {
        defaultValue: '{{count}} kart çekimi mutabakat bekliyor — şube cihaz sayfasından inceleyin.',
        count: data.length,
      })}
    </div>
  );
}
